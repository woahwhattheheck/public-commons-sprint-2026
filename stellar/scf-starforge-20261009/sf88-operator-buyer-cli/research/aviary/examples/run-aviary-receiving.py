#!/usr/bin/env python3
"""One retained Aviary HTTP/storage receiving journey; no deployed Aviary access.

The application under --application is the actual maintained product. The two
loopback servers implement the pinned AVP importer contract, preserve their
original IDs/state and inject the declared failures. This is contract receiving,
not acceptance by a live Aviary organization or a media-transcoding service.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import copy
import csv
import datetime as dt
from email import policy
from email.parser import BytesParser
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
import io
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import traceback
from urllib.parse import parse_qs, urlsplit
import wave
import zipfile

SCHEMA = "commons.aviary-provider-contract-receiving.v1"
OPERATION = "aviary-http-receiving-6ba15-20261012"
PROVIDER_COMMIT = "9f189144f6434e6561696983edce17494aa66dd0"
PROVIDER_IMPORTER = "e8c612495fb851b1e756a32143c032feaa5d264d"
TOKEN_ENV = "COMMONS_AVIARY_CONTRACT_TOKEN"
TOKEN = "commons-aviary-local-contract-token-not-a-service-credential"
PART_SIZE = 5 * 1024 * 1024
PCM_BYTES = PART_SIZE + 256 * 1024
CHUNK = 256 * 1024
COLLECTION = "8701"
RESOURCE = "9101"
MEDIA_LOCAL = "9201"
MEDIA_LINKED = "9202"
TRANSCRIPT = "9301"
INDEX = "9401"
SUPPLEMENTAL = "9501"
UPLOAD = "receiving-upload-9201-original"
EXCLUDED_KEY = "effective-excluded"
VTT = ("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n"
       "Retained receiving source — exact UTF-8 transcript.\n").encode("utf-8")
APP_FILES = ("aviary.py", "aviary_client.py", "server.py", "index.html",
             "app.js", "cli.mjs", "README.md", "PROVIDER_CONTRACT.md")


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode()


def require(condition, code, detail=None):
    if not condition:
        raise RuntimeError(json.dumps({"code": code, "details": detail},
                                      ensure_ascii=False, sort_keys=True))


def fingerprint(path):
    value, size = hashlib.sha256(), 0
    with open(path, "rb") as source:
        while block := source.read(CHUNK):
            value.update(block)
            size += len(block)
    return {"bytes": size, "sha256": value.hexdigest()}


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_bytes(path, value, *, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if immutable and path.exists():
        require(path.read_bytes() == value, "RETAINED_BYTES_CHANGED", str(path))
        return
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(value)
            output.flush()
            os.fsync(output.fileno())
        if immutable:
            os.link(temporary, path)
            os.unlink(temporary)
        else:
            os.replace(temporary, path)
        sync_dir(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path, value, **options):
    write_bytes(path, encoded(value), **options)


def read_json(path):
    return json.loads(Path(path).read_bytes())


def inventory(root):
    root = Path(root)
    result = []
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), "INPUT_SYMLINK", str(path))
        if path.is_file() and "__pycache__" not in path.parts:
            result.append({"path": path.relative_to(root).as_posix(), **fingerprint(path)})
    return result


def load_application(directory):
    directory = Path(directory).resolve()
    for filename in APP_FILES:
        require((directory / filename).is_file(), "APPLICATION_INCOMPLETE", filename)
    sys.path.insert(0, str(directory))
    a = importlib.import_module("aviary")
    c = importlib.import_module("aviary_client")
    require(Path(a.__file__).resolve().parent == directory and
            Path(c.__file__).resolve().parent == directory,
            "APPLICATION_IMPORT_IDENTITY")
    require(a.CONTRACT["commit"] == PROVIDER_COMMIT and
            a.CONTRACT["bulkImporterBlob"] == PROVIDER_IMPORTER,
            "ORIGINAL_PROVIDER_CONTRACT_CHANGED", a.CONTRACT)
    return a, c


def make_fixture(a, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    audio = directory / "assets" / "held-multipart.wav"
    audio.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not audio.exists():
        fd, temporary = tempfile.mkstemp(prefix=".wav-", dir=audio.parent)
        try:
            with os.fdopen(fd, "w+b") as raw:
                with wave.open(raw, "wb") as output:
                    output.setnchannels(1)
                    output.setsampwidth(2)
                    output.setframerate(8000)
                    remaining = PCM_BYTES
                    block = b"\0" * CHUNK
                    while remaining:
                        length = min(remaining, len(block))
                        output.writeframesraw(block[:length])
                        remaining -= length
                raw.flush()
                os.fsync(raw.fileno())
            os.link(temporary, audio)
            sync_dir(audio.parent)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    with wave.open(str(audio), "rb") as check:
        require(check.getnchannels() == 1 and check.getsampwidth() == 2 and
                check.getframerate() == 8000 and check.getnframes() * 2 == PCM_BYTES,
                "ORIGINAL_WAV_CHANGED")
    write_bytes(directory / "assets" / "receiving.vtt", VTT, immutable=True)
    write_bytes(directory / "assets" / "index.vtt",
                b"WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nOriginal receiving index\n",
                immutable=True)
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
    write_bytes(directory / "assets" / "supplemental.png", png, immutable=True)
    rows = {
        "resources": [{
            "Resource User Key": "source-resource", "Title": "Aviary receiving cohort",
            "Public": "no", "Featured": "no", "Custom Unique Identifier": "Receiving_Cohort",
            "Description": "One declared local contract receiving operation",
            "Rights Statement": "Generated receiving fixture; no customer collection content",
        }],
        "media": [
            {"Resource User Key": "source-resource", "Media User Key": "source-local",
             "Display Name": "Receiving multipart audio", "Path": "assets/held-multipart.wav",
             "Sequence #": "1", "Public": "no", "360 Video": "no",
             "Description": "Original local WAV for the multipart receiving path",
             "Rights": "Generated receiving fixture"},
            {"Resource User Key": "source-resource", "Media User Key": "source-linked",
             "Display Name": "Receiving linked media",
             "URL": "https://example.invalid/receiving-linked.webm",
             "Sequence #": "2", "Public": "no", "360 Video": "no",
             "Rights": "Contract fixture URL; the local service does not dereference it"},
            {"Resource User Key": "source-resource", "Media User Key": "source-excluded",
             "Display Name": "Retained excluded source row", "Path": "missing.wav",
             "Sequence #": "bad", "Public": "invalid", "360 Video": "no"},
        ],
        "transcripts": [{
            "Media User Key": "source-local", "Sequence #": "1", "Language": "English",
            "Title": "Receiving transcript", "Path": "assets/receiving.vtt", "Public": "no",
            "Captions": "yes", "Ignore Title": "no", "Description": "Exact UTF-8 source",
        }],
        "indexes": [{
            "Media User Key": "source-local", "Sequence #": "1", "Language": "English",
            "Title": "Receiving index", "Path": "assets/index.vtt", "Public": "no",
            "Description": "Original retained source index",
        }],
        "supplemental": [{
            "Resource User Key": "source-resource", "Title": "Receiving supplemental",
            "Public": "no", "File Path": "assets/supplemental.png",
            "Description": "One original resource-level supplemental image",
        }],
    }
    for kind in a.KINDS:
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=list(a.FIELDS[kind]), lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows[kind])
        write_bytes(directory / a.FILENAMES[kind], buffer.getvalue().encode("utf-8"),
                    immutable=True)
    write_bytes(directory / "RECEIVING_SOURCE.md",
        ("# Generated Aviary receiving source\n\n"
         "Six included rows and one retained excluded malformed row exercise the "
         "original provider contract. The WAV contains generated silent PCM. "
         "The linked media URL is a literal fixture value and is never fetched. "
         "No record in this source represents a deployed Aviary collection.\n").encode(),
        immutable=True)
    return {"files": inventory(directory), "audio": fingerprint(audio),
            "counts": {"resources": 1, "media": 2, "transcripts": 1,
                       "indexes": 1, "supplemental": 1}}


def parse_body(handler, raw):
    content_type = handler.headers.get("Content-Type", "")
    fields, files = {}, {}
    if content_type.startswith("application/json"):
        fields = json.loads(raw) if raw else {}
    elif content_type.startswith("application/x-www-form-urlencoded"):
        fields = {key: values[-1] for key, values in parse_qs(raw.decode(), keep_blank_values=True).items()}
    elif content_type.startswith("multipart/form-data"):
        message = BytesParser(policy=policy.default).parsebytes(
            ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw)
        require(message.is_multipart(), "HTTP_MULTIPART_REQUIRED")
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            require(isinstance(name, str) and name not in fields and name not in files,
                    "HTTP_MULTIPART_FIELD", name)
            value = part.get_payload(decode=True)
            if part.get_filename() is not None:
                files[name] = {"filename": part.get_filename(),
                               "contentType": part.get_content_type(),
                               "bytes": len(value), "sha256": hashlib.sha256(value).hexdigest(),
                               "value": value}
            else:
                fields[name] = value.decode(part.get_content_charset() or "utf-8")
    elif raw:
        raise RuntimeError("UNSUPPORTED_HTTP_BODY: " + content_type)
    return fields, files


class ProviderState:
    def __init__(self, root, fixture):
        self.root = Path(root)
        self.fixture = fixture
        self.lock = threading.RLock()
        self.path = self.root / "provider-state.json"
        self.value = read_json(self.path) if self.path.exists() else {
            "schema": "commons.aviary-contract-service.v1", "sequence": 0,
            "apiPort": 0, "storagePort": 0, "records": {
                "resources": {}, "media_files": {}, "transcripts": {},
                "indexes": {}, "supplemental_files": {}},
            "counts": {}, "parts": {}, "loseFirstLocalCreate": True,
            "failSecondPart": True, "violations": [], "stages": {},
        }
        self.api = None
        self.storage = None

    def persist(self):
        write_json(self.path, self.value)

    def count(self, key):
        self.value["counts"][key] = self.value["counts"].get(key, 0) + 1
        return self.value["counts"][key]

    def violation(self, code, details=None):
        with self.lock:
            self.value["violations"].append({"at": now(), "code": code, "details": details})
            self.persist()

    def request_record(self, handler, raw=None, body_descriptor=None):
        with self.lock:
            self.value["sequence"] += 1
            number = self.value["sequence"]
            relative = f"http/{number:05d}"
            if raw is not None:
                write_bytes(self.root / (relative + ".request.bin"), raw, immutable=True)
                body_descriptor = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                                   "path": relative + ".request.bin"}
            headers = {key: value for key, value in handler.headers.items()
                       if key.lower() not in ("authorization", "cookie")}
            value = {"at": now(), "method": handler.command, "target": handler.path,
                     "role": handler.server.role, "headers": headers,
                     "authorizationPresent": handler.headers.get("Authorization") is not None,
                     "cookiePresent": handler.headers.get("Cookie") is not None,
                     "body": body_descriptor}
            write_json(self.root / (relative + ".request.json"), value, immutable=True)
            self.persist()
            return number

    def response_record(self, number, status, body, headers=None, *, state="HTTP_RESPONSE"):
        with self.lock:
            relative = f"http/{number:05d}"
            value = {"at": now(), "state": state, "status": status, "headers": headers or {}}
            if body is not None:
                write_bytes(self.root / (relative + ".response.bin"), body, immutable=True)
                value["body"] = {"path": relative + ".response.bin",
                                 "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
            write_json(self.root / (relative + ".response.json"), value, immutable=True)

    def media_model(self, identifier):
        record = copy.deepcopy(self.value["records"]["media_files"][str(identifier)])
        if str(identifier) == MEDIA_LOCAL:
            count = (self.fixture["audio"]["bytes"] + PART_SIZE - 1) // PART_SIZE
            record["multipart_upload"] = {
                "upload_id": UPLOAD, "part_size": PART_SIZE, "parts_count": count,
                "parts": [{"part_number": number,
                           "url": self.storage + f"/parts/{UPLOAD}/{number}?X-Amz-Signature=local-original-{number}"}
                          for number in range(1, count + 1)],
            }
        return record

    def resource_model(self):
        record = copy.deepcopy(self.value["records"]["resources"][RESOURCE])
        record["transcripts_id"] = sorted(self.value["records"]["transcripts"])
        return record

    def mutation_counts(self):
        return {key: value for key, value in self.value["counts"].items()
                if key.startswith(("CREATE:", "PUT_PART:", "COMPLETE:", "METADATA:"))}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *_):
        pass

    @property
    def state(self):
        return self.server.state

    def send_record(self, number, status, value=None, headers=None, raw=None):
        body = encoded(value) if raw is None else raw
        selected = {"Content-Type": "application/json; charset=utf-8",
                    "Content-Length": str(len(body)),
                    "X-Request-ID": f"receiving-{number:05d}", "Connection": "close", **(headers or {})}
        self.state.response_record(number, status, body, selected)
        self.close_connection = True
        self.send_response(status)
        for key, value in selected.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def drop_response(self, number):
        self.state.response_record(number, None, None, state="CONNECTION_CLOSED_WITHOUT_RESPONSE")
        self.close_connection = True
        with contextlib.suppress(OSError):
            self.connection.shutdown(socket.SHUT_RDWR)
        self.connection.close()

    def body(self, maximum=16 * 1024 * 1024):
        length = int(self.headers.get("Content-Length", "0"))
        require(0 <= length <= maximum, "HTTP_LENGTH", length)
        raw = self.rfile.read(length)
        require(len(raw) == length, "HTTP_SHORT_BODY", {"expected": length, "actual": len(raw)})
        return raw

    def authorized(self, number):
        if self.headers.get("Authorization") != "Bearer " + TOKEN:
            self.state.violation("API_AUTHORIZATION_SCOPE", {"request": number})
            self.send_record(number, 401, {"error": "Expected selected loopback receiving credential"})
            return False
        return True

    def do_POST(self):
        self.api_mutation("POST")

    def do_PUT(self):
        if self.server.role == "storage":
            self.storage_put()
        else:
            self.api_mutation("PUT")

    def api_mutation(self, method):
        raw = self.body()
        number = self.state.request_record(self, raw)
        try:
            require(self.server.role == "api", "WRONG_MUTATION_ORIGIN")
            if not self.authorized(number):
                return
            parsed = urlsplit(self.path)
            fields, files = parse_body(self, raw)
            query = {key: values[-1] for key, values in parse_qs(parsed.query, keep_blank_values=True).items()}
            path = parsed.path
            with self.state.lock:
                if method == "POST" and path == "/api/v1/resources":
                    require(fields.get("collection_id") == COLLECTION, "RESOURCE_COLLECTION", fields)
                    self.state.count("CREATE:resources")
                    require(RESOURCE not in self.state.value["records"]["resources"],
                            "DUPLICATE_RESOURCE_CREATION")
                    record = {key: value for key, value in fields.items() if key != "resource_user_key"}
                    record["id"] = RESOURCE
                    record["url"] = self.state.api + "/collections/" + COLLECTION + "/collection_resources/" + RESOURCE
                    self.state.value["records"]["resources"][RESOURCE] = record
                    self.state.persist()
                    self.send_record(number, 201, {"data": {"update": record}})
                    return
                if method == "POST" and path == "/api/v1/media_files":
                    is_local = query.get("media_file") == "presigned"
                    values = query if is_local else fields
                    identifier = MEDIA_LOCAL if is_local else MEDIA_LINKED
                    self.state.count("CREATE:media_files:" + identifier)
                    require(identifier not in self.state.value["records"]["media_files"],
                            "DUPLICATE_MEDIA_CREATION", identifier)
                    require(str(values.get("collection_resource_id")) == RESOURCE, "MEDIA_PARENT", values)
                    if is_local:
                        require(files.get("media_file", {}).get("value") == b"presigned",
                                "PRESIGNED_MULTIPART_MARKER")
                        require(query.get("multipart") == "true" and
                                int(query.get("file_size", "0")) == self.state.fixture["audio"]["bytes"] and
                                int(query.get("part_size", "0")) == PART_SIZE,
                                "MULTIPART_CREATE_CONTRACT", query)
                    else:
                        require(values.get("media_file_link") ==
                                "https://example.invalid/receiving-linked.webm",
                                "LINKED_MEDIA_CONTRACT", values)
                    record = {key: value for key, value in values.items()
                              if key not in ("resource_user_key", "media_user_key")}
                    record["id"] = identifier
                    self.state.value["records"]["media_files"][identifier] = record
                    lost = is_local and self.state.value["loseFirstLocalCreate"]
                    if lost:
                        self.state.value["loseFirstLocalCreate"] = False
                    self.state.persist()
                    if lost:
                        self.drop_response(number)
                    else:
                        self.send_record(number, 201, {"data": self.state.media_model(identifier)})
                    return
                if method == "PUT" and re.fullmatch(r"/api/v1/media_files/[1-9][0-9]*", path):
                    identifier = path.rsplit("/", 1)[-1]
                    require(identifier in self.state.value["records"]["media_files"], "MEDIA_UPDATE_ID")
                    require(isinstance(fields.get("metadata"), dict), "MEDIA_METADATA_BODY", fields)
                    self.state.count("METADATA:" + identifier)
                    self.state.value["records"]["media_files"][identifier]["metadata"] = fields["metadata"]
                    self.state.persist()
                    self.send_record(number, 200, {"data": self.state.media_model(identifier)})
                    return
                attachments = {
                    "/api/v1/transcripts": ("transcripts", TRANSCRIPT, "resource_file_id", MEDIA_LOCAL, "receiving.vtt"),
                    "/api/v1/indexes": ("indexes", INDEX, "resource_file_id", MEDIA_LOCAL, "index.vtt"),
                    "/api/v1/supplemental_files": ("supplemental_files", SUPPLEMENTAL, "collection_resource_id", RESOURCE, "supplemental.png"),
                }
                if method == "POST" and path in attachments:
                    kind, identifier, parent_field, parent, filename = attachments[path]
                    require(str(fields.get(parent_field)) == parent, "ATTACHMENT_PARENT", fields)
                    require(identifier not in self.state.value["records"][kind],
                            "DUPLICATE_ATTACHMENT_CREATION", kind)
                    upload = files.get("associated_file")
                    expected = fingerprint(self.state.root / "source" / "assets" / filename)
                    require(upload and upload["bytes"] == expected["bytes"] and
                            upload["sha256"] == expected["sha256"],
                            "ATTACHMENT_SOURCE_BYTES", kind)
                    self.state.count("CREATE:" + kind)
                    record = dict(fields, id=identifier)
                    self.state.value["records"][kind][identifier] = record
                    self.state.persist()
                    self.send_record(number, 201, {"data": record})
                    return
            self.send_record(number, 404, {"error": "Unimplemented declared contract path", "path": path})
        except BaseException as error:
            self.state.violation("UNEXPECTED_SERVICE_CONTRACT", {"type": type(error).__name__, "message": str(error)})
            if not self.close_connection:
                with contextlib.suppress(OSError):
                    self.send_record(number, 500, {"error": str(error)})

    def do_GET(self):
        number = self.state.request_record(self, b"")
        try:
            parsed = urlsplit(self.path)
            if self.server.role == "storage":
                require(self.headers.get("Authorization") is None and self.headers.get("Cookie") is None,
                        "STORAGE_CREDENTIAL_LEAK")
                require(parsed.path == "/transcripts/receiving.vtt", "STORAGE_GET_PATH", parsed.path)
                with self.state.lock:
                    self.state.count("TRANSCRIPT_STORAGE_GET")
                    self.state.persist()
                self.send_record(number, 200, headers={"Content-Type": "text/vtt; charset=utf-8"}, raw=VTT)
                return
            if not self.authorized(number):
                return
            path = parsed.path
            with self.state.lock:
                self.state.count("GET:" + path)
                if path == "/api/v1/resources/" + RESOURCE:
                    self.state.persist()
                    self.send_record(number, 200, {"data": self.state.resource_model()})
                    return
                if path in ("/api/v1/media_files/" + MEDIA_LOCAL, "/api/v1/media_files/" + MEDIA_LINKED):
                    self.state.persist()
                    self.send_record(number, 200, {"data": self.state.media_model(path.rsplit("/", 1)[-1])})
                    return
                if path == "/api/v1/media_files/" + MEDIA_LOCAL + "/complete":
                    query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
                    require(query.get("upload_id") == UPLOAD and query.get("parts_count") == "2",
                            "ORIGINAL_COMPLETION_IDENTITY", query)
                    require(set(self.state.value["parts"]) == {"1", "2"}, "PARTS_NOT_COMPLETE")
                    digest_value = hashlib.sha256()
                    size = 0
                    for part in (1, 2):
                        with open(self.state.root / "storage" / f"part-{part}.bin", "rb") as original:
                            while block := original.read(CHUNK):
                                digest_value.update(block)
                                size += len(block)
                    require({"bytes": size, "sha256": digest_value.hexdigest()} == self.state.fixture["audio"],
                            "STORAGE_WHOLE_SOURCE_CHANGED")
                    self.state.count("COMPLETE:" + MEDIA_LOCAL)
                    self.state.value.setdefault("completedMedia", {})[MEDIA_LOCAL] = {
                        "at": now(), "bytes": size, "sha256": digest_value.hexdigest()}
                    self.state.persist()
                    self.send_record(number, 200, {"data": self.state.media_model(MEDIA_LOCAL)})
                    return
                if path == "/api/v1/transcripts/" + TRANSCRIPT:
                    record = copy.deepcopy(self.state.value["records"]["transcripts"][TRANSCRIPT])
                    record["export"] = {"vtt": {"file_name": "receiving.vtt",
                        "file": self.state.api + "/download/transcripts/" + TRANSCRIPT + "/vtt"}}
                    self.state.persist()
                    self.send_record(number, 200, {"data": record})
                    return
                if path == "/download/transcripts/" + TRANSCRIPT + "/vtt":
                    self.state.count("TRANSCRIPT_API_REDIRECT")
                    self.state.persist()
                    self.send_record(number, 302, headers={
                        "Location": self.state.storage + "/transcripts/receiving.vtt?X-Amz-Signature=local-export",
                        "Content-Type": "text/plain"}, raw=b"")
                    return
            self.send_record(number, 404, {"error": "Unimplemented declared contract path", "path": path})
        except BaseException as error:
            self.state.violation("UNEXPECTED_SERVICE_CONTRACT", {"type": type(error).__name__, "message": str(error)})
            with contextlib.suppress(OSError):
                self.send_record(number, 500, {"error": str(error)})

    def storage_put(self):
        descriptor = None
        number = None
        temporary = None
        try:
            parsed = urlsplit(self.path)
            matched = re.fullmatch(r"/parts/" + re.escape(UPLOAD) + r"/([12])", parsed.path)
            require(matched is not None, "ORIGINAL_STORAGE_PART_ID", parsed.path)
            part_number = int(matched.group(1))
            require(self.headers.get("Authorization") is None and self.headers.get("Cookie") is None,
                    "STORAGE_CREDENTIAL_LEAK")
            require(parse_qs(parsed.query).get("X-Amz-Signature") == [f"local-original-{part_number}"],
                    "ORIGINAL_STORAGE_CAPABILITY")
            offset = (part_number - 1) * PART_SIZE
            expected_length = min(PART_SIZE, self.state.fixture["audio"]["bytes"] - offset)
            length = int(self.headers.get("Content-Length", "-1"))
            require(length == expected_length, "ORIGINAL_STORAGE_PART_LENGTH")
            destination = self.state.root / "storage" / f"part-{part_number}.bin"
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd, temporary = tempfile.mkstemp(prefix=".part-", dir=destination.parent)
            h, count = hashlib.sha256(), 0
            with os.fdopen(fd, "wb") as output:
                remaining = length
                while remaining:
                    block = self.rfile.read(min(remaining, CHUNK))
                    require(bool(block), "STORAGE_SHORT_BODY")
                    output.write(block)
                    h.update(block)
                    count += len(block)
                    remaining -= len(block)
                output.flush()
                os.fsync(output.fileno())
            expected = hashlib.sha256()
            with open(self.state.root / "source" / "assets" / "held-multipart.wav", "rb") as source:
                source.seek(offset)
                remaining = length
                while remaining:
                    block = source.read(min(remaining, CHUNK))
                    require(bool(block), "ORIGINAL_SOURCE_SHORT")
                    expected.update(block)
                    remaining -= len(block)
            require(h.hexdigest() == expected.hexdigest(), "TRANSFERRED_PART_CHANGED")
            descriptor = {"bytes": count, "sha256": h.hexdigest(),
                          "part": part_number, "offset": offset, "uploadId": UPLOAD}
            number = self.state.request_record(self, body_descriptor=descriptor)
            with self.state.lock:
                self.state.count("PUT_PART:" + str(part_number))
                if part_number == 2 and self.state.value["failSecondPart"]:
                    self.state.count("PUT_PART_2_INJECTED_FAILURE")
                    self.state.persist()
                    self.send_record(number, 503, {"error": "Declared second-part receiving interruption"})
                    return
                if destination.exists():
                    require(fingerprint(destination) == {"bytes": count, "sha256": h.hexdigest()},
                            "REPEATED_PART_BYTES_CHANGED")
                else:
                    os.link(temporary, destination)
                    sync_dir(destination.parent)
                self.state.value["parts"][str(part_number)] = descriptor
                self.state.persist()
                self.send_record(number, 200, headers={"ETag": '"' + h.hexdigest() + '"'}, raw=b"")
        except BaseException as error:
            self.state.violation("UNEXPECTED_STORAGE_CONTRACT", {"type": type(error).__name__, "message": str(error)})
            if number is None:
                number = self.state.request_record(self, body_descriptor=descriptor)
            with contextlib.suppress(OSError):
                self.send_record(number, 500, {"error": str(error)})
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)


class Servers:
    def __init__(self, state):
        self.state = state
        self.servers = []
        self.threads = []

    def __enter__(self):
        try:
            for role, field in (("api", "apiPort"), ("storage", "storagePort")):
                server = ThreadingHTTPServer(("127.0.0.1", self.state.value[field]), Handler)
                server.daemon_threads = False
                server.block_on_close = True
                server.role, server.state = role, self.state
                self.servers.append(server)
                self.state.value[field] = server.server_port
                setattr(self.state, role, "http://127.0.0.1:" + str(server.server_port))
            self.state.persist()
            for server in self.servers:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                self.threads.append(thread)
            return self
        except BaseException:
            for server in self.servers:
                server.server_close()
            raise

    def __exit__(self, *_):
        for server in self.servers:
            server.shutdown()
        for server in self.servers:
            server.server_close()
        for thread in self.threads:
            thread.join(timeout=5)
        require(not any(thread.is_alive() for thread in self.threads), "RECEIVING_SERVER_NOT_DRAINED")


def saved_actions(a, workspace, operation_id):
    with a.connect(workspace) as db:
        return {row["action_key"]: dict(row) for row in db.execute(
            "SELECT * FROM actions WHERE run_id=? ORDER BY action_key", (operation_id,))}


def stage_path(root, name):
    return root / "stages" / (name + ".json")


def retained_native_package(a, workspace, output, model):
    """Recover a published native ZIP's missing sidecar from its original mapping."""
    output = Path(output)
    sidecar = output.with_suffix(output.suffix + ".manifest.json")
    if not output.exists():
        require(not sidecar.exists(), "RETAINED_NATIVE_PACKAGE_MISSING", str(output))
        return a.build_package(workspace, output, model["revision"])
    a.verify_source(workspace)
    if sidecar.exists():
        package = read_json(sidecar)
    else:
        rows, assets = a.package_rows(Path(workspace), model)
        entries = []
        for kind in a.KINDS:
            fields = list(a.FIELDS[kind]) + sorted(
                {field for row in rows[kind] for field in row} - set(a.FIELDS[kind]))
            buffer = io.StringIO(newline="")
            writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\r\n")
            writer.writeheader()
            writer.writerows(rows[kind])
            content = buffer.getvalue().encode("utf-8")
            entries.append({"path": "aviary-package/" + a.FILENAMES[kind],
                            "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
        for name, item in sorted(assets.items()):
            entries.append({"path": "aviary-package/" + name,
                            "bytes": item["bytes"], "sha256": item["sha256"]})
        package = {"schema": "stellar-forge.aviary-package.v1",
                   **{key: model[key] for key in (
                       "revision", "mappingSha256", "sourceManifestSha256", "counts")},
                   "files": entries, **fingerprint(output)}
        a.verify_zip(output, entries)
        write_json(sidecar, package, immutable=True)
    require(package["schema"] == "stellar-forge.aviary-package.v1" and
            all(package[key] == model[key] for key in (
                "revision", "mappingSha256", "sourceManifestSha256", "counts")),
            "RETAINED_NATIVE_PACKAGE_IDENTITY")
    a.verify_zip(output, package["files"])
    require(fingerprint(output) == {key: package[key] for key in ("bytes", "sha256")},
            "RETAINED_NATIVE_PACKAGE_BYTES")
    return dict(package, output=str(output), reused=True)


def handoff_document(a, source):
    with zipfile.ZipFile(source) as archive:
        require(archive.namelist().count("MANIFEST.json") == 1, "RETAINED_HANDOFF_MANIFEST")
        raw = archive.read("MANIFEST.json")
        manifest = json.loads(raw)
    require(manifest.get("schema") == "stellar-forge.aviary-handoff.v1",
            "RETAINED_HANDOFF_SCHEMA")
    declared = manifest["files"] + [{"path": "MANIFEST.json",
        "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}]
    a.verify_zip(source, declared)
    return manifest, declared


def operation_projection(status):
    """Keep saved plan/action identities; repeated reads may add audit timestamps."""
    return {
        "workspace": status["workspace"], "mapping": status["mapping"],
        "runs": sorted([{
            "id": run["id"], "revision": run["revision"], "target": run["target"],
            "states": run["states"],
            "actions": sorted([{key: action[key] for key in
                ("action_key", "state", "provider_id")} for action in run["actions"]],
                key=lambda item: item["action_key"])
        } for run in status["runs"]], key=lambda item: item["id"]),
        "downloads": sorted([{key: item[key] for key in ("path", "bytes", "sha256")}
            for item in status["downloads"]], key=lambda item: item["path"])
    }


def retained_handoff_export(a, workspace, output):
    """Adopt an already-published complete export without rewriting its bytes."""
    output, workspace = Path(output), Path(workspace)
    if not output.exists():
        return a.export_workspace(workspace, output)
    manifest, declared = handoff_document(a, output)
    a.verify_source(workspace)
    model, status = a.preview(workspace), a.show(workspace)
    require(manifest["workspaceId"] == status["workspace"]["id"] and
            manifest["contract"] == a.CONTRACT, "RETAINED_HANDOFF_IDENTITY")
    with zipfile.ZipFile(output) as archive:
        saved_model = json.loads(archive.read("delivery/preview.json"))
        saved_status = json.loads(archive.read("delivery/status.json"))
        require(all(saved_model[key] == model[key] for key in (
                    "revision", "mappingSha256", "sourceManifestSha256")) and
                operation_projection(saved_status) == operation_projection(status),
                "RETAINED_HANDOFF_WORKSPACE_CHANGED")
        require(archive.read("workspace/source-manifest.json") ==
                (workspace / "source-manifest.json").read_bytes(),
                "RETAINED_HANDOFF_SOURCE_CHANGED")
    members = {item["path"]: item for item in declared}
    application = Path(a.__file__).resolve().parent
    for name in APP_FILES:
        item = members.get("application/" + name)
        require(item is not None and fingerprint(application / name) ==
                {key: item[key] for key in ("bytes", "sha256")},
                "RETAINED_HANDOFF_APPLICATION_CHANGED", name)
    return {"output": str(output), "schema": manifest["schema"],
            "members": len(declared), "workspaceId": manifest["workspaceId"],
            **fingerprint(output), "reused": True}


def retained_handoff_receive(a, source, output):
    """Resume only exact members (or exact interrupted prefixes) of the saved ZIP."""
    source, output = Path(source), Path(output)
    if not output.exists():
        return a.receive(source, output)
    require(output.is_dir() and not output.is_symlink(),
            "RETAINED_RECEIVING_DIRECTORY", str(output))
    manifest, declared = handoff_document(a, source)
    expected = {item["path"]: item for item in declared}
    for path in output.rglob("*"):
        require(not path.is_symlink(), "RETAINED_RECEIVING_SYMLINK", str(path))
        if path.is_file():
            require(path.relative_to(output).as_posix() in expected,
                    "RETAINED_RECEIVING_EXTRA_MEMBER", str(path))
        else:
            require(path.is_dir(), "RETAINED_RECEIVING_FILE_TYPE", str(path))
    recovered = []
    with zipfile.ZipFile(source) as archive:
        for item in declared:
            destination = a.within(output, item["path"])
            before = destination.stat() if destination.exists() else None
            original = fingerprint(destination) if before is not None else None
            wanted = {key: item[key] for key in ("bytes", "sha256")}
            if original == wanted:
                continue
            if before is not None:
                require(destination.is_file() and original["bytes"] < item["bytes"],
                        "RETAINED_RECEIVING_MEMBER_CHANGED", item["path"])
                prefix = hashlib.sha256()
                remaining = original["bytes"]
                with archive.open(item["path"]) as incoming:
                    while remaining:
                        block = incoming.read(min(CHUNK, remaining))
                        require(bool(block), "RETAINED_RECEIVING_PREFIX_SHORT", item["path"])
                        prefix.update(block)
                        remaining -= len(block)
                require(prefix.hexdigest() == original["sha256"],
                        "RETAINED_RECEIVING_PREFIX_CHANGED", item["path"])
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            flags = os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW
            if before is None:
                flags |= os.O_CREAT | os.O_EXCL
            fd = os.open(destination, flags, 0o600)
            with os.fdopen(fd, "ab") as outgoing, archive.open(item["path"]) as incoming:
                opened = os.fstat(outgoing.fileno())
                require((before is None and opened.st_size == 0) or
                        (before is not None and
                         (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) ==
                         (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)),
                        "RETAINED_RECEIVING_CONCURRENT_CHANGE", item["path"])
                # The receiving directory is private until every member is verified.
                # Append only after the exact retained prefix; a killed append remains
                # the same recognizable prefix on the next receiving invocation.
                if original is not None:
                    incoming.seek(original["bytes"])
                while block := incoming.read(CHUNK):
                    outgoing.write(block)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            require(fingerprint(destination) == wanted,
                    "RETAINED_RECEIVING_ARCHIVE_MEMBER", item["path"])
            sync_dir(destination.parent)
            recovered.append({"path": item["path"], "retainedPrefix": original})
    for item in declared:
        require(fingerprint(a.within(output, item["path"])) ==
                {key: item[key] for key in ("bytes", "sha256")},
                "RETAINED_RECEIVING_MEMBER_BYTES", item["path"])
    a.verify_source(output / "workspace")
    status = a.show(output / "workspace")
    require(status["workspace"]["id"] == manifest["workspaceId"],
            "RETAINED_RECEIVING_WORKSPACE_ID")
    return {"output": str(output), "workspace": str(output / "workspace"),
            "application": str(output / "application"), "status": status,
            "reused": True, "recoveredMembers": recovered}

def initial_workspace(a, c, root, config):
    workspace = root / "workspace"
    receipt = stage_path(root, "01-prepared")
    if receipt.exists():
        saved = read_json(receipt)
        require(a.show(workspace)["workspace"]["id"] == saved["workspaceId"], "PREPARED_WORKSPACE_CHANGED")
        c.plan(workspace, config, OPERATION, saved["revision"])
        return saved
    status = a.initialize(root / "source", workspace, label="Aviary original HTTP receiving")
    selected = copy.deepcopy(status["mapping"]["document"])
    resource_values = {"source-resource": "effective-resource"}
    media_values = {"source-local": "effective-local", "source-linked": "effective-linked",
                    "source-excluded": EXCLUDED_KEY}
    for kind, table in selected["tables"].items():
        maps = table.setdefault("valueMaps", {})
        if kind in ("resources", "media", "supplemental"):
            maps["Resource User Key"] = resource_values
        if kind in ("media", "transcripts", "indexes"):
            maps["Media User Key"] = media_values
    selected.setdefault("exclude", {}).setdefault("media", {})[EXCLUDED_KEY] = (
        "Original malformed sequence/path row retained; excluded explicitly for receiving.")
    changed = a.save_mapping(workspace, selected, status["mapping"]["revision"])
    candidate = a.preview(workspace)
    assigned = (a.allocate_keys(workspace, changed["revision"]) if not candidate["ready"]
                else {"revision": changed["revision"], "reused": True})
    model = a.preview(workspace)
    require(model["ready"] and model["counts"] == {
        "resources": 1, "media": 2, "transcripts": 1, "indexes": 1, "supplemental": 1},
        "REVIEWED_INCLUDED_ROWS", model["issues"])
    excluded = [row for row in model["tables"]["media"] if not row["included"]]
    require(len(excluded) == 1 and excluded[0]["source"]["values"]["Sequence #"] == "bad",
            "EXCLUDED_ORIGINAL_ROW_LOST")
    local = next(row for row in model["tables"]["media"] if row["values"]["Path"] == "assets/held-multipart.wav")
    resource = model["tables"]["resources"][0]
    require(local["parent"]["key"] == resource["values"]["Resource User Key"],
            "EFFECTIVE_KEY_PARENT_MAPPING")
    plan = c.plan(workspace, config, OPERATION, model["revision"])
    package = retained_native_package(a, workspace, root / "original-native-package.zip", model)
    value = {"workspaceId": model["workspace"]["id"], "revision": model["revision"],
             "mappingSha256": model["mappingSha256"], "sourceManifestSha256": model["sourceManifestSha256"],
             "localMediaKey": local["values"]["Media User Key"], "localOriginalKey": local["key"],
             "excludedOriginalRow": excluded[0], "plan": plan, "package": package,
             "assignedRevision": assigned["revision"]}
    write_json(receipt, value, immutable=True)
    return value


def cold_reopen(args):
    root = Path(args.out).resolve()
    a, c = load_application(args.application)
    workspace = Path(args.workspace).resolve()
    expected = read_json(root / "cold-expected.json")
    status = a.show(workspace, OPERATION)
    require(status["workspace"]["id"] == expected["workspaceId"], "COLD_WORKSPACE_ID")
    model = a.preview(workspace)
    excluded = [row for row in model["tables"]["media"] if not row["included"]]
    require(len(excluded) == 1 and excluded[0]["source"]["values"]["Sequence #"] == "bad",
            "COLD_EXCLUSION_PROVENANCE")
    require(model["sourceManifestSha256"] == expected["sourceManifestSha256"], "COLD_SOURCE_ID")
    plan = c.plan(workspace, read_json(root / "client-config.json"), OPERATION, expected["revision"])
    require(plan["reused"], "COLD_ORIGINAL_OPERATION_NOT_REUSED")
    result = c.run(workspace, OPERATION)
    require(result["state"] == "COMPLETE", "COLD_COMPLETED_RUN", result.get("errors"))
    exports = c.export_transcripts(workspace, OPERATION)
    require(len(exports["files"]) == 1 and exports["files"][0].get("reused") is True,
            "COLD_TRANSCRIPT_NOT_REUSED", exports)
    entry = exports["files"][0]
    require(fingerprint(workspace / entry["path"]) ==
            {"bytes": len(VTT), "sha256": hashlib.sha256(VTT).hexdigest()},
            "COLD_TRANSCRIPT_BYTES")
    completed_export = retained_handoff_export(a, workspace, root / "completed-workspace.zip")
    value = {"schema": SCHEMA + ".cold-reopen", "at": now(),
             "workspaceId": status["workspace"]["id"], "sourceManifestSha256": model["sourceManifestSha256"],
             "operationId": OPERATION, "state": result["state"],
             "actions": [{"key": key, "state": item["state"], "providerId": item["provider_id"]}
                         for key, item in saved_actions(a, workspace, OPERATION).items()],
             "transcripts": exports, "completeWorkspace": completed_export}
    write_json(root / "cold-reopen-result.json", value, immutable=True)
    print(json.dumps({"state": value["state"], "receipt": str(root / "cold-reopen-result.json")}))
    return 0


def receiving(args):
    root, application = Path(args.out).resolve(), Path(args.application).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    final = root / "receiving-result.json"
    if final.exists():
        value = read_json(final)
        for item in value["artifacts"]:
            require(fingerprint(root / item["path"]) == {"bytes": item["bytes"], "sha256": item["sha256"]},
                    "COMPLETED_RECEIVING_ARTIFACT_CHANGED", item["path"])
        print(json.dumps({"state": value["state"], "reused": True, "receipt": str(final)}))
        return 0
    a, c = load_application(application)
    app_manifest = [{"path": name, **fingerprint(application / name)} for name in APP_FILES]
    write_json(root / "application-source.json",
               {"directory": str(application), "files": app_manifest, "contract": a.CONTRACT},
               immutable=True)
    if args.example:
        example = Path(args.example).resolve()
        require(example.is_dir(), "EXAMPLE_DIRECTORY")
        write_json(root / "original-example-inventory.json",
                   {"directory": str(example), "files": inventory(example),
                    "scope": "Original provided example retained as a separately identified input; the fault journey uses generated source."},
                   immutable=True)
    fixture = make_fixture(a, root / "source")
    write_json(root / "generated-source-inventory.json", fixture, immutable=True)
    os.environ[TOKEN_ENV] = TOKEN
    state = ProviderState(root, fixture)
    result = None
    with Servers(state):
        config = {"schema": "stellar-forge.aviary-client.v1", "baseUrl": state.api,
                  "collectionId": COLLECTION, "tokenEnv": TOKEN_ENV,
                  "authorizationScheme": "Bearer", "allowLoopback": True,
                  "partSize": PART_SIZE, "multipartThreshold": PART_SIZE, "timeoutSeconds": 5}
        write_json(root / "client-config.json", config, immutable=True)
        prepared = initial_workspace(a, c, root, config)
        workspace = root / "workspace"
        action = "media:" + prepared["localMediaKey"] + ":create"
        prefix = "media:" + prepared["localMediaKey"]
        first = stage_path(root, "02-lost-creation-response")
        if not first.exists():
            first_result = c.run(workspace, OPERATION)
            actions = saved_actions(a, workspace, OPERATION)
            require(first_result["state"] == "PARTIAL" and actions[action]["state"] in ("DISPATCHING", "UNCERTAIN"),
                    "UNKNOWN_CREATION_NOT_RETAINED", first_result)
            require(state.value["counts"].get("CREATE:resources") == 1 and
                    state.value["counts"].get("CREATE:media_files:" + MEDIA_LOCAL) == 1 and
                    state.value["counts"].get("CREATE:media_files:" + MEDIA_LINKED) == 1,
                    "FIRST_CHILD_PROGRESS")
            repeated = c.run(workspace, OPERATION)
            require(repeated["state"] == "PARTIAL" and
                    state.value["counts"].get("CREATE:media_files:" + MEDIA_LOCAL) == 1,
                    "UNCERTAIN_CREATION_REPLAYED")
            write_json(first, {"first": first_result, "sameOperationRead": repeated,
                              "originalAction": action, "originalProviderId": MEDIA_LOCAL,
                              "counts": copy.deepcopy(state.value["counts"])}, immutable=True)
        adopted = stage_path(root, "03-original-id-adopted")
        if not adopted.exists():
            current = saved_actions(a, workspace, OPERATION)[action]
            if current["state"] in ("DISPATCHING", "UNCERTAIN"):
                adoption = c.reconcile(workspace, OPERATION, action, MEDIA_LOCAL,
                    "Original local service retained this ID before deliberately closing its creation response.")
            else:
                require(current["state"] in ("ADOPTED", "CONFIRMED") and current["provider_id"] == MEDIA_LOCAL,
                        "ADOPTED_ID_CHANGED")
                adoption = {"state": current["state"], "providerId": current["provider_id"], "reused": True}
            write_json(adopted, adoption, immutable=True)
        partial = stage_path(root, "04-second-part-retained")
        if not partial.exists():
            require(state.value["failSecondPart"], "PART_FAILURE_BARRIER_LOST")
            partial_result = c.run(workspace, OPERATION)
            actions = saved_actions(a, workspace, OPERATION)
            require(partial_result["state"] == "PARTIAL" and
                    actions[prefix + ":part:1"]["state"] == "CONFIRMED" and
                    actions[prefix + ":part:2"]["state"] in ("UPLOAD_PENDING", "UPLOADING"),
                    "MULTIPART_PARTIAL_STATE", partial_result)
            require(state.value["counts"].get("PUT_PART:1") == 1 and
                    state.value["counts"].get("PUT_PART_2_INJECTED_FAILURE", 0) >= 3 and
                    "2" not in state.value["parts"] and not state.value["counts"].get("COMPLETE:" + MEDIA_LOCAL),
                    "MULTIPART_INTERRUPTION_BOUNDARY", state.value["counts"])
            write_json(partial, {"run": partial_result, "counts": copy.deepcopy(state.value["counts"]),
                                 "originalUploadId": UPLOAD,
                                 "part1": state.value["parts"]["1"]}, immutable=True)
        with state.lock:
            state.value["failSecondPart"] = False
            state.persist()
        completed = stage_path(root, "05-completed-original-operation")
        if not completed.exists():
            complete_result = c.run(workspace, OPERATION)
            require(complete_result["state"] == "COMPLETE", "COMPLETE_NATIVE_RUN", complete_result)
            expected_creates = {"CREATE:resources": 1, "CREATE:media_files:" + MEDIA_LOCAL: 1,
                "CREATE:media_files:" + MEDIA_LINKED: 1, "CREATE:transcripts": 1,
                "CREATE:indexes": 1, "CREATE:supplemental_files": 1}
            require(all(state.value["counts"].get(key) == value for key, value in expected_creates.items()),
                    "DESCENDANT_CREATION_REPLAY", state.value["counts"])
            require(state.value["counts"].get("PUT_PART:1") == 1 and
                    state.value["counts"].get("COMPLETE:" + MEDIA_LOCAL) == 1,
                    "ORIGINAL_PART_OR_COMPLETION_REPLAY")
            exports = c.export_transcripts(workspace, OPERATION)
            require(len(exports["files"]) == 1, "TRANSCRIPT_EXPORT_COUNT", exports)
            exported = exports["files"][0]
            require(fingerprint(workspace / exported["path"]) ==
                    {"bytes": len(VTT), "sha256": hashlib.sha256(VTT).hexdigest()},
                    "TRANSCRIPT_EXPORT_BYTES")
            portable = retained_handoff_export(a, workspace, root / "portable-workspace.zip")
            received = retained_handoff_receive(a, root / "portable-workspace.zip", root / "received")
            require(received["status"]["workspace"]["id"] == prepared["workspaceId"],
                    "PORTABLE_WORKSPACE_ID")
            # The native portable projection removes only the ephemeral capability URLs.
            with a.connect(received["workspace"]) as db:
                response = json.loads(db.execute(
                    "SELECT response FROM actions WHERE run_id=? AND action_key=?", (OPERATION, action)).fetchone()[0])
            raw_projection = encoded(response)
            require(b"[local upload URL removed]" in raw_projection and b"local-original-" not in raw_projection,
                    "PORTABLE_CAPABILITY_REDACTION")
            write_json(completed, {"run": complete_result, "transcripts": exports,
                                  "portable": portable, "received": received,
                                  "counts": copy.deepcopy(state.value["counts"])}, immutable=True)
        write_json(root / "cold-expected.json", {
            key: prepared[key] for key in ("workspaceId", "sourceManifestSha256", "revision")},
            immutable=True)
        cold = root / "cold-reopen-result.json"
        if not cold.exists():
            before = copy.deepcopy(state.mutation_counts())
            storage_gets = state.value["counts"].get("TRANSCRIPT_STORAGE_GET", 0)
            argv = [sys.executable, "-B", str(Path(__file__).resolve()), "--cold-reopen",
                    "--application", str(root / "received" / "application"),
                    "--workspace", str(root / "received" / "workspace"), "--out", str(root)]
            with open(root / "cold-reopen.stdout.json", "wb") as out, open(root / "cold-reopen.stderr.log", "wb") as error:
                child = subprocess.run(argv, stdout=out, stderr=error, timeout=180, check=False)
            require(child.returncode == 0, "COLD_NATIVE_PROCESS_FAILED",
                    {"returncode": child.returncode, "stderr": "cold-reopen.stderr.log"})
            require(cold.exists() and state.mutation_counts() == before and
                    state.value["counts"].get("TRANSCRIPT_STORAGE_GET", 0) == storage_gets,
                    "COLD_REOPEN_REPLAYED_REMOTE_MUTATION")
        cold_value = read_json(cold)
        require(cold_value["workspaceId"] == prepared["workspaceId"] and cold_value["state"] == "COMPLETE",
                "COLD_RESULT_IDENTITY")
        require(state.value["counts"].get("TRANSCRIPT_API_REDIRECT") == 1 and
                state.value["counts"].get("TRANSCRIPT_STORAGE_GET") == 1 and
                not state.value["violations"], "HTTP_CREDENTIAL_OR_CONTRACT_VIOLATION", state.value["violations"])
        result = {"schema": SCHEMA, "state": "PASS", "operationId": OPERATION,
                  "startedOrResumedAt": now(), "workspaceId": prepared["workspaceId"],
                  "providerContract": a.CONTRACT, "application": app_manifest,
                  "scope": {"service": "Pinned-contract loopback API/storage receiving",
                            "deployedAviaryAcceptance": False, "nativeAviaryIngestJob": False,
                            "realServiceCredentialUsed": False,
                            "nativeWorkspaceAndClientUsed": True,
                            "coldProcessUsedReceivedApplication": True,
                            "originalSourceRows": 7, "includedSourceRows": 6,
                            "excludedOriginalRowsRetained": 1},
                  "providerIds": {"resource": RESOURCE, "media": [MEDIA_LOCAL, MEDIA_LINKED],
                                  "transcript": TRANSCRIPT, "index": INDEX,
                                  "supplemental": SUPPLEMENTAL, "uploadId": UPLOAD},
                  "counts": copy.deepcopy(state.value["counts"]),
                  "checks": {
                      "unknownCreationBlockedUntilOriginalIdAdoption": True,
                      "firstCompletedPartNotReplayed": True,
                      "sameMultipartIdentityAndCompleteSourceBytes": True,
                      "descendantsAndSupplementalCreatedExactlyOnce": True,
                      "excludedMalformedOriginalRetainedAndSkipped": True,
                      "effectiveParentKeysAllocatedBeforePlanning": True,
                      "coldPortableRunDoesNotUseRedactedUploadUrls": True,
                      "transcriptRedirectKeepsTokenAtApiOrigin": True,
                      "coldTranscriptExportReusesOriginalBytes": True}}
    result["serversDrainedAt"] = now()
    result["artifacts"] = [{"path": path.relative_to(root).as_posix(), **fingerprint(path)}
        for path in sorted(root.rglob("*")) if path.is_file()
        and (path.relative_to(root).parts[0] in ("stages", "http", "storage") or path.name in (
            "application-source.json", "generated-source-inventory.json", "provider-state.json",
            "client-config.json", "cold-expected.json", "original-example-inventory.json",
            "original-native-package.zip", "original-native-package.zip.manifest.json",
            "portable-workspace.zip", "completed-workspace.zip", "cold-reopen-result.json",
            "cold-reopen.stdout.json", "cold-reopen.stderr.log"))]
    write_json(final, result, immutable=True)
    print(json.dumps({"state": result["state"], "receipt": str(final),
                      "completeWorkspace": str(root / "completed-workspace.zip"),
                      "counts": result["counts"]}, sort_keys=True))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--example")
    parser.add_argument("--out", required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--cold-reopen", action="store_true")
    args = parser.parse_args()
    try:
        return cold_reopen(args) if args.cold_reopen else receiving(args)
    except BaseException as error:
        root = Path(args.out).resolve()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        value = {"schema": SCHEMA + ".interruption", "at": now(),
                 "type": type(error).__name__, "message": str(error),
                 "traceback": traceback.format_exc(), "operationId": OPERATION,
                 "scope": "Local pinned-contract receiving; no deployed Aviary mutation"}
        write_json(root / ("cold-interruption.json" if args.cold_reopen else "receiving-interruption.json"), value)
        print(json.dumps(value, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

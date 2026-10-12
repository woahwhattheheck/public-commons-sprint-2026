#!/usr/bin/env python3
"""Receive the five preserved Comic Relief originals for one complete operation.

Read a private JSON document from stdin. Download URLs are invocation inputs, never
source constants or output fields. This command does not invoke a converter or app.
"""
from __future__ import annotations
import datetime as dt
import fcntl
import io
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

OPERATION = "scf-grant-portfolio-comic-relief-9b23-20261012"
SCHEMA = "comic-relief.original-inputs/v1"
FILES = {
    "comic-relief-cprojects-grants-original.xml": 2478357,
    "comic-relief-international-2015-2022-original.xlsx": 210128,
    "comic-relief-international-2022-2026-original.xlsx": 39278,
    "360giving-original-registry-20261012.json": 758668,
    "comic-relief-360giving-original-publisher-metadata.json": 4479,
}
REGISTRY_IDS = ("a002400000WUhUuAAL", "a00P400000OMLeUIAX")
MAX_EXPANDED_XLSX = 100 * 1024 * 1024
MAX_CURRENT_XLSX = 32 * 1024 * 1024
CURRENT_2015_URL = "https://docs.google.com/spreadsheets/d/1D9mrF9RZ-CzL09PKAnLFcv8vbaZmfO_LKcLwlNQaWN8/export?format=xlsx"
CURRENT_CAPTURE_SCHEMA = "comic-relief.current-publisher-capture/v1"


class InputError(RuntimeError):
    pass


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def plain_file(path):
    try:
        return stat.S_ISREG(path.lstat().st_mode)
    except FileNotFoundError:
        return False


def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def publish(path, content):
    if path.exists() or path.is_symlink():
        if not plain_file(path) or path.read_bytes() != content:
            raise InputError("ORIGINAL_INPUT_PUBLICATION_CONFLICT:" + path.name)
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".original-publish-", dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if not plain_file(path) or path.read_bytes() != content:
                raise InputError("ORIGINAL_INPUT_PUBLICATION_CONFLICT:" + path.name)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def retained_identity(item):
    result = {"name": item["name"], "bytes": item["bytes"]}
    if "reference" in item:
        reference = item["reference"]
        if not isinstance(reference, str) or not reference.startswith("notion-file-block://"):
            raise InputError("ORIGINAL_INPUT_REFERENCE_INVALID")
        result["reference"] = reference
    return result


def validate_request(value):
    if not isinstance(value, dict) or value.get("operationId") != OPERATION:
        raise InputError("ORIGINAL_OPERATION_MISMATCH")
    if set(value) - {"operationId", "outputDirectory", "sources", "captureCurrent2015"}:
        raise InputError("ORIGINAL_REQUEST_FIELDS_INVALID")
    if type(value.get("captureCurrent2015", False)) is not bool:
        raise InputError("CURRENT_PUBLISHER_CAPTURE_SELECTION_INVALID")
    output = value.get("outputDirectory")
    if not isinstance(output, str) or not Path(output).is_absolute():
        raise InputError("ORIGINAL_OUTPUT_DIRECTORY_MUST_BE_ABSOLUTE")
    sources = value.get("sources")
    if not isinstance(sources, list) or len(sources) != len(FILES):
        raise InputError("ORIGINAL_FIVE_SOURCES_REQUIRED")
    selected = {}
    for item in sources:
        if not isinstance(item, dict) or set(item) - {"name", "bytes", "url", "sourcePath", "reference", "sha256"}:
            raise InputError("ORIGINAL_INPUT_FIELDS_INVALID")
        name = item.get("name")
        if name not in FILES or name in selected or type(item.get("bytes")) is not int or item["bytes"] != FILES[name]:
            raise InputError("ORIGINAL_INPUT_NAME_OR_SIZE_MISMATCH")
        if ("url" in item) == ("sourcePath" in item):
            raise InputError("ORIGINAL_INPUT_SINGLE_CARRIER_REQUIRED")
        if "url" in item:
            url = item["url"]
            if not isinstance(url, str):
                raise InputError("ORIGINAL_INPUT_HTTPS_REQUIRED")
            parsed = urllib.parse.urlsplit(url)
            if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
                raise InputError("ORIGINAL_INPUT_HTTPS_REQUIRED")
        else:
            path = item["sourcePath"]
            if not isinstance(path, str) or not Path(path).is_absolute() or not plain_file(Path(path)):
                raise InputError("ORIGINAL_INPUT_LOCAL_FILE_INVALID")
        expected_sha = item.get("sha256")
        if expected_sha is not None and (not isinstance(expected_sha, str) or len(expected_sha) != 64 or any(c not in "0123456789abcdef" for c in expected_sha)):
            raise InputError("ORIGINAL_INPUT_HASH_INVALID")
        retained_identity(item)
        selected[name] = item
    return Path(output), selected


def receive_file(root, item):
    target = root / item["name"]
    records = root / ".original-file-records"
    records.mkdir(mode=0o700, exist_ok=True)
    if records.is_symlink() or not records.is_dir():
        raise InputError("ORIGINAL_FILE_RECORD_DIRECTORY_INVALID")
    record_path = records / (item["name"] + ".json")
    item = dict(item)
    if record_path.exists() or record_path.is_symlink():
        if not plain_file(record_path):
            raise InputError("ORIGINAL_FILE_RECORD_INVALID:" + target.name)
        record = json.loads(record_path.read_text(encoding="utf-8"))
        if {key: value for key, value in record.items() if key != "sha256"} != retained_identity(item):
            raise InputError("ORIGINAL_FILE_RECORD_SOURCE_CONFLICT:" + target.name)
        if item.get("sha256") and record.get("sha256") != item["sha256"]:
            raise InputError("ORIGINAL_FILE_RECORD_HASH_CONFLICT:" + target.name)
        item["sha256"] = record["sha256"]
    if target.exists() or target.is_symlink():
        if not plain_file(target) or target.stat().st_size != item["bytes"]:
            raise InputError("ORIGINAL_INPUT_RETAINED_FILE_CONFLICT:" + target.name)
        actual = digest(target)
        if item.get("sha256"):
            if item["sha256"] != actual:
                raise InputError("ORIGINAL_INPUT_RETAINED_HASH_CONFLICT:" + target.name)
            publish(record_path, canonical({**retained_identity(item), "sha256": actual}))
            return {**retained_identity(item), "path": str(target), "sha256": actual}
        # An untracked complete file must be compared with the same preserved
        # source once. A killed download never turns an arbitrary file into custody.
    descriptor, temporary_name = tempfile.mkstemp(prefix=".original-download-", dir=root)
    temporary = Path(temporary_name)
    try:
        if "sourcePath" in item:
            incoming = Path(item["sourcePath"]).open("rb")
        else:
            try:
                incoming = urllib.request.urlopen(urllib.request.Request(item["url"], headers={"User-Agent": "Commons-Comic-Relief-Source-Receiving/1"}), timeout=90)
            except urllib.error.HTTPError as error:
                raise InputError("ORIGINAL_INPUT_HTTP_" + str(error.code) + ":" + target.name) from None
            except (urllib.error.URLError, TimeoutError):
                raise InputError("ORIGINAL_INPUT_DOWNLOAD_FAILED:" + target.name) from None
        size = 0
        h = hashlib.sha256()
        with incoming, os.fdopen(descriptor, "wb") as outgoing:
            descriptor = None
            while True:
                data = incoming.read(min(1024 * 1024, item["bytes"] + 1 - size))
                if not data:
                    break
                size += len(data)
                if size > item["bytes"]:
                    raise InputError("ORIGINAL_INPUT_SIZE_EXCEEDED:" + target.name)
                h.update(data)
                outgoing.write(data)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        if size != item["bytes"]:
            raise InputError("ORIGINAL_INPUT_SIZE_MISMATCH:" + target.name)
        actual = h.hexdigest()
        if item.get("sha256") and item["sha256"] != actual:
            raise InputError("ORIGINAL_INPUT_HASH_MISMATCH:" + target.name)
        # Freeze source identity before publishing its complete bytes. On a kill
        # between these steps the same input is downloaded against this exact hash.
        publish(record_path, canonical({**retained_identity(item), "sha256": actual}))
        try:
            os.link(temporary, target)
        except FileExistsError:
            if not plain_file(target) or target.stat().st_size != size or digest(target) != actual:
                raise InputError("ORIGINAL_INPUT_PUBLICATION_CONFLICT:" + target.name)
        fsync_directory(root)
        return {**retained_identity(item), "path": str(target), "sha256": actual}
    finally:
        if descriptor is not None:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)



def inspect_xlsx(data, name):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            names = [item.filename for item in entries]
            if len(set(names)) != len(names):
                raise InputError("ORIGINAL_XLSX_DUPLICATE_MEMBER:" + name)
            if sum(item.file_size for item in entries) > MAX_EXPANDED_XLSX:
                raise InputError("ORIGINAL_XLSX_EXPANSION_LIMIT:" + name)
            if "[Content_Types].xml" not in names or "xl/workbook.xml" not in names:
                raise InputError("ORIGINAL_XLSX_STRUCTURE_INVALID:" + name)
            if archive.testzip() is not None:
                raise InputError("ORIGINAL_XLSX_CRC_INVALID:" + name)
    except zipfile.BadZipFile:
        raise InputError("ORIGINAL_XLSX_ARCHIVE_INVALID:" + name) from None


class HttpsRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise InputError("CURRENT_PUBLISHER_REDIRECT_NOT_HTTPS")
        return super().redirect_request(request, response, code, message, headers, newurl)


def current_publisher_2015(root):
    """Freeze one actual HTTP observation before publishing any derived member."""
    capsule_path = root / "current-publisher-2015-capture.zip"
    if capsule_path.exists() or capsule_path.is_symlink():
        if not plain_file(capsule_path) or capsule_path.stat().st_size > MAX_CURRENT_XLSX + 65536:
            raise InputError("CURRENT_PUBLISHER_CAPSULE_INVALID")
    else:
        started = dt.datetime.now(dt.timezone.utc).isoformat()
        request = urllib.request.Request(CURRENT_2015_URL, headers={
            "User-Agent": "Commons-Comic-Relief-Source-Receiving/1",
            "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
        try:
            with urllib.request.build_opener(HttpsRedirects()).open(request, timeout=90) as response:
                if response.status != 200:
                    raise InputError("CURRENT_PUBLISHER_HTTP_" + str(response.status))
                payload = response.read(MAX_CURRENT_XLSX + 1)
                if len(payload) > MAX_CURRENT_XLSX:
                    raise InputError("CURRENT_PUBLISHER_SOURCE_SIZE_LIMIT")
                final = urllib.parse.urlsplit(response.geturl())
                if final.scheme != "https" or not final.hostname:
                    raise InputError("CURRENT_PUBLISHER_FINAL_URL_NOT_HTTPS")
                headers = {name: response.headers.get(name) for name in
                           ("Content-Type", "Content-Length", "Last-Modified", "ETag")
                           if response.headers.get(name) is not None}
                if any(len(value) > 8192 for value in headers.values()):
                    raise InputError("CURRENT_PUBLISHER_HEADER_SIZE_LIMIT")
                observed = {
                    "schema": CURRENT_CAPTURE_SCHEMA, "operationId": OPERATION,
                    "sourceUrl": CURRENT_2015_URL, "registryId": REGISTRY_IDS[0],
                    "acquisition": "current-publisher-http",
                    "startedAt": started,
                    "completedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "response": {"status": response.status, "finalHost": final.hostname, "headers": headers},
                    "original": {"name": "publisher-original.xlsx", "bytes": len(payload),
                                 "sha256": hashlib.sha256(payload).hexdigest()},
                    "meaning": "A current HTTP capture at the recorded time; this is distinct from the retained Drive export and from the dated DataGetter metadata.",
                }
        except urllib.error.HTTPError as error:
            raise InputError("CURRENT_PUBLISHER_HTTP_" + str(error.code)) from None
        except (urllib.error.URLError, TimeoutError):
            raise InputError("CURRENT_PUBLISHER_DOWNLOAD_FAILED") from None
        inspect_xlsx(payload, "current-publisher-2015")
        capsule = io.BytesIO()
        with zipfile.ZipFile(capsule, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("publisher-original.xlsx", payload)
            archive.writestr("capture.json", canonical(observed))
        # One immutable publication binds the first complete source to its actual
        # response/time. A kill while deriving members resumes from this capsule.
        publish(capsule_path, capsule.getvalue())
    try:
        with zipfile.ZipFile(capsule_path) as archive:
            if sorted(archive.namelist()) != ["capture.json", "publisher-original.xlsx"]:
                raise InputError("CURRENT_PUBLISHER_CAPSULE_MEMBERS_INVALID")
            if sum(item.file_size for item in archive.infolist()) > MAX_CURRENT_XLSX + 65536:
                raise InputError("CURRENT_PUBLISHER_CAPSULE_SIZE_LIMIT")
            if archive.testzip() is not None:
                raise InputError("CURRENT_PUBLISHER_CAPSULE_CRC_INVALID")
            payload = archive.read("publisher-original.xlsx")
            capture_bytes = archive.read("capture.json")
    except zipfile.BadZipFile:
        raise InputError("CURRENT_PUBLISHER_CAPSULE_ARCHIVE_INVALID") from None
    observed = json.loads(capture_bytes)
    if (observed.get("schema") != CURRENT_CAPTURE_SCHEMA or observed.get("operationId") != OPERATION
            or observed.get("sourceUrl") != CURRENT_2015_URL or observed.get("registryId") != REGISTRY_IDS[0]
            or observed.get("acquisition") != "current-publisher-http"):
        raise InputError("CURRENT_PUBLISHER_CAPTURE_IDENTITY_CONFLICT")
    expected = {"name": "publisher-original.xlsx", "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest()}
    if observed.get("original") != expected or not payload or len(payload) > MAX_CURRENT_XLSX:
        raise InputError("CURRENT_PUBLISHER_CAPTURE_SOURCE_CONFLICT")
    for key in ("startedAt", "completedAt"):
        value = observed.get(key)
        if not isinstance(value, str) or dt.datetime.fromisoformat(value).utcoffset() is None:
            raise InputError("CURRENT_PUBLISHER_CAPTURE_TIME_INVALID")
    inspect_xlsx(payload, "current-publisher-2015")
    source_path = root / "current-publisher-2015-original.xlsx"
    capture_path = root / "current-publisher-2015-capture.json"
    publish(source_path, payload)
    publish(capture_path, capture_bytes)
    def identity(path):
        return {"name": path.name, "path": str(path), "bytes": path.stat().st_size, "sha256": digest(path)}
    return {"schema": CURRENT_CAPTURE_SCHEMA, "sourceUrl": CURRENT_2015_URL,
            "registryId": REGISTRY_IDS[0], "capturedAt": observed["completedAt"],
            "capsule": identity(capsule_path), "source": identity(source_path), "capture": identity(capture_path)}


def selected_registry(value):
    found = {identifier: [] for identifier in REGISTRY_IDS}

    def visit(node, path):
        if isinstance(node, dict):
            if "distribution" in node:
                identities = [node.get("id"), node.get("identifier"), node.get("name")]
                if path and isinstance(path[-1], str):
                    identities.append(path[-1])
                for identifier in REGISTRY_IDS:
                    if identifier in identities:
                        found[identifier].append((list(path), node))
            for key, child in node.items():
                visit(child, [*path, key])
        elif isinstance(node, list):
            for index, child in enumerate(node):
                visit(child, [*path, index])

    visit(value, [])
    selected = []
    for identifier in REGISTRY_IDS:
        matches = found[identifier]
        if len(matches) != 1:
            raise InputError("ORIGINAL_REGISTRY_UNIQUE_RECORD_REQUIRED:" + identifier)
        path, record = matches[0]
        selected.append((identifier, path, record))
    return selected


def inspect_originals(root, received):
    for name in FILES:
        if name.endswith(".xlsx"):
            with zipfile.ZipFile(root / name) as archive:
                if sum(info.file_size for info in archive.infolist()) > MAX_EXPANDED_XLSX:
                    raise InputError("ORIGINAL_XLSX_EXPANSION_LIMIT:" + name)
                if "[Content_Types].xml" not in archive.namelist() or "xl/workbook.xml" not in archive.namelist():
                    raise InputError("ORIGINAL_XLSX_STRUCTURE_INVALID:" + name)
                if archive.testzip() is not None:
                    raise InputError("ORIGINAL_XLSX_CRC_INVALID:" + name)
    xml = ET.parse(root / "comic-relief-cprojects-grants-original.xml").getroot()
    local = lambda tag: tag.rsplit("}", 1)[-1]
    if local(xml.tag) != "iati-activities":
        raise InputError("ORIGINAL_IATI_ROOT_INVALID")
    iati = {"root": xml.tag, "attributes": dict(xml.attrib)}
    for label, tag in (("activities", "iati-activity"), ("transactions", "transaction"), ("budgets", "budget")):
        iati[label] = sum(1 for element in xml.iter() if local(element.tag) == tag)
    registry_file = root / "360giving-original-registry-20261012.json"
    registry = json.loads(registry_file.read_text(encoding="utf-8"))
    records = []
    for identifier, locator, value in selected_registry(registry):
        name = identifier + "-registry.json"
        path = root / name
        publish(path, canonical(value))
        records.append({"id": identifier, "locatorPath": locator, "name": name, "path": str(path), "bytes": path.stat().st_size, "sha256": digest(path)})
    metadata_path = root / "comic-relief-360giving-original-publisher-metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("prefix") != "360G-CR" or not isinstance(metadata.get("files"), list):
        raise InputError("ORIGINAL_PUBLISHER_METADATA_INVALID")
    ids = [item.get("id") for item in metadata["files"] if isinstance(item, dict)]
    if any(ids.count(identifier) != 1 for identifier in REGISTRY_IDS):
        raise InputError("ORIGINAL_PUBLISHER_DATASET_ID_MISMATCH")
    return {
        "schema": SCHEMA, "operationId": OPERATION, "files": received,
        "iati": iati,
        "registry": {"topType": type(registry).__name__, "source": str(registry_file), "sourceSha256": digest(registry_file), "selected": records},
    }


def receive(value):
    root, selected = validate_request(value)
    if root.is_symlink():
        raise InputError("ORIGINAL_OUTPUT_SYMLINK_INVALID")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not root.is_dir():
        raise InputError("ORIGINAL_OUTPUT_DIRECTORY_INVALID")
    os.chmod(root, 0o700)
    guard_path = root / ".original-materialization.guard"
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(guard_path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise InputError("ORIGINAL_GUARD_INVALID")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise InputError("ORIGINAL_MATERIALIZATION_ACTIVE") from None
        manifest_path = root / "original-file-identities.json"
        if manifest_path.exists():
            if not plain_file(manifest_path):
                raise InputError("ORIGINAL_MANIFEST_INVALID")
            prior = json.loads(manifest_path.read_text(encoding="utf-8"))
            if prior.get("schema") != SCHEMA or prior.get("operationId") != OPERATION:
                raise InputError("ORIGINAL_MANIFEST_IDENTITY_CONFLICT")
            if ("currentPublisher2015" in prior) != value.get("captureCurrent2015", False):
                raise InputError("CURRENT_PUBLISHER_CAPTURE_SELECTION_CONFLICT")
            retained = {item["name"]: item for item in prior["files"]}
            if set(retained) != set(FILES):
                raise InputError("ORIGINAL_MANIFEST_SOURCE_SET_CONFLICT")
            for name in FILES:
                item = selected[name]
                if item.get("reference") != retained[name].get("reference"):
                    raise InputError("ORIGINAL_MANIFEST_REFERENCE_CONFLICT:" + name)
                item = dict(item)
                item["sha256"] = retained[name]["sha256"]
                selected[name] = item
        received = [receive_file(root, selected[name]) for name in FILES]
        manifest = inspect_originals(root, received)
        if value.get("captureCurrent2015", False):
            manifest["currentPublisher2015"] = current_publisher_2015(root)
        publish(manifest_path, canonical(manifest))
        return {"operationId": OPERATION, "manifest": str(manifest_path), "manifestSha256": digest(manifest_path),
                "files": [{key: value for key, value in item.items() if key != "reference"} for item in received],
                "iati": manifest["iati"], "registry": manifest["registry"],
                **({"currentPublisher2015": manifest["currentPublisher2015"]} if "currentPublisher2015" in manifest else {})}
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        result = receive(json.load(sys.stdin))
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    except InputError as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        raise SystemExit(1)

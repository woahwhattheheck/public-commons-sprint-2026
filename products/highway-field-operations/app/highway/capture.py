#!/usr/bin/env python3
"""Read-only, resumable ArcGIS capture. No edit, replica, or comparison operation.
All observed HTTP bodies are retained verbatim; a completed capture is immutable.
"""
from __future__ import annotations
import argparse
import datetime as dt
import email.utils
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

SCHEMA = "geocove.arcgis-capture.v1"
MAX_JSON = 32 * 1024 * 1024
MAX_ATTACHMENT = 64 * 1024 * 1024
MAX_REQUESTS = 30000


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def require(test, message):
    if not test:
        raise ValueError(message)


def decode_json(data):
    def pairs(rows):
        out = {}
        for key, value in rows:
            require(key not in out, "Duplicate JSON property in original response.")
            out[key] = value
        return out
    def invalid(value):
        raise ValueError("Non-finite JSON number: " + value)
    return json.loads(data.decode("utf-8-sig"), object_pairs_hook=pairs,
                      parse_constant=invalid)


def identifier(value):
    require(isinstance(value, str) and str(uuid.UUID(value)) == value,
            "Use an explicit canonical UUID.")
    return value


def oid(value):
    require(type(value) is int and 0 <= value <= 9223372036854775807,
            "This capture requires original integer ObjectIDs.")
    return value


def ids(value):
    require(isinstance(value, list), "Original objectIds must be an array.")
    result = [oid(item) for item in value]
    require(len(set(result)) == len(result), "Original ObjectID query contains duplicates.")
    return sorted(result)


def service_url(value):
    parsed = urllib.parse.urlsplit(value)
    require(parsed.scheme == "https" and parsed.hostname and not parsed.username
            and not parsed.password and not parsed.query and not parsed.fragment,
            "Select an explicit HTTPS FeatureServer URL without credentials or query.")
    require(parsed.path.rstrip("/").endswith("/FeatureServer"),
            "Select the FeatureServer root, not a layer or edit endpoint.")
    require(not any(part in (".", "..") for part in parsed.path.split("/"))
            and "%" not in parsed.path and not re.search(r"[\x00-\x20\\]", value),
            "Use a literal unambiguous service URL.")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def sync_directory(path):
    handle = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(handle)
    finally:
        os.close(handle)


def regular_bytes(path, limit):
    handle = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(handle)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= limit,
                "Retained input is not a bounded regular file.")
        with os.fdopen(handle, "rb", closefd=False) as stream:
            data = stream.read(limit + 1)
        after = os.fstat(handle)
        require(len(data) == before.st_size and
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "Retained input changed while reading.")
        return data
    finally:
        os.close(handle)


def atomic(path, data, immutable=False):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(path.parent.resolve() == path.parent and not path.is_symlink(),
            "Retained paths must remain real paths.")
    if path.exists() and immutable:
        require(regular_bytes(path, len(data)) == data, "Immutable original bytes changed.")
        return
    handle, name = tempfile.mkstemp(prefix=".capture-", dir=path.parent)
    try:
        os.fchmod(handle, 0o600)
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                os.link(name, path)
            except FileExistsError:
                require(regular_bytes(path, len(data)) == data, "Immutable original bytes conflict.")
            os.unlink(name)
        else:
            os.replace(name, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class CaptureFailure(RuntimeError):
    def __init__(self, message, *, status=None, outcome=None):
        super().__init__(message)
        self.status, self.outcome = status, outcome


class Receiver:
    def __init__(self, root, binding, token, retry_failed):
        self.root, self.binding, self.token = root, binding, token
        self.retry_failed = retry_failed
        self.opener = urllib.request.build_opener(NoRedirect())
        self.files = {}
        self.requests = 0
        self.total = 0
        self.requests_root = root / "requests"
        self.objects_root = root / "objects"
        for directory in (self.requests_root, self.objects_root):
            directory.mkdir(mode=0o700, exist_ok=True)
            require(directory.resolve() == directory, "Capture storage must not be aliased.")

    def descriptor(self, path, data, media_type):
        return {"sha256": digest(data), "bytes": len(data),
                "mediaType": media_type, "path": str(path.relative_to(self.root))}

    def register(self, descriptor):
        path = descriptor["path"]
        require(path not in self.files or self.files[path] == descriptor,
                "A retained file identity changed.")
        if path not in self.files:
            require(self.total + descriptor["bytes"] <= self.binding["limits"]["maxBytes"],
                    "Capture byte budget reached; no data was silently truncated.")
            self.total += descriptor["bytes"]
            self.files[path] = descriptor
        return descriptor

    def read_descriptor(self, descriptor):
        relative = Path(descriptor["path"])
        require(not relative.is_absolute() and ".." not in relative.parts,
                "Invalid retained relative file path.")
        path = self.root / relative
        require(path.resolve() == path, "Retained payload path was aliased.")
        data = regular_bytes(path, descriptor["bytes"])
        require(len(data) == descriptor["bytes"] and digest(data) == descriptor["sha256"],
                "Retained source bytes failed their original identity.")
        self.register(descriptor)
        return data

    def retain(self, data, media_type):
        require(not self.token or self.token.encode() not in data,
                "Response echoed the selected credential; no credential bytes were retained.")
        path = self.objects_root / (digest(data) + ".bin")
        descriptor = self.descriptor(path, data, media_type)
        self.register(descriptor)
        atomic(path, data, immutable=True)
        return descriptor

    def record_file(self, path):
        data = regular_bytes(path, MAX_JSON)
        self.register(self.descriptor(path, data, "application/json"))
        return decode_json(data)

    def not_before(self, headers):
        value = headers.get("Retry-After")
        if not value:
            return None, False
        if value.strip().isdigit():
            digits = value.strip().lstrip("0") or "0"
            if len(digits) > 18:
                return None, True
            try:
                return time.time() + int(digits), False
            except (ValueError, OverflowError):
                return None, True
        try:
            parsed = email.utils.parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.timestamp(), False
        except OverflowError:
            return None, True
        except ValueError:
            return None, False

    def request(self, key, suffix, parameters=None, binary=False):
        # The caller supplies only original metadata/query/attachment read paths.
        require(re.fullmatch(r"(?:|/\d+|/\d+/query|/\d+/\d+/attachments(?:/\d+)?)", suffix),
                "Capture permits only feature-service read endpoints.")
        parameters = parameters or {}
        url = self.binding["serviceUrl"] + suffix
        method = "POST" if suffix.endswith("/query") else "GET"
        request = {"schema": "geocove.arcgis-read-request.v1", "key": key,
                   "method": method, "url": url, "parameters": parameters,
                   "binary": binary, "credentialEnvironment": self.binding["tokenEnv"]}
        key_hash = digest(canonical({"key": key}))
        directory = self.requests_root / key_hash
        directory.mkdir(mode=0o700, exist_ok=True)
        require(directory.resolve() == directory, "Request directory was aliased.")
        intent = directory / "intent.json"
        atomic(intent, canonical(request), immutable=True)
        self.record_file(intent)
        returns = sorted(directory.glob("attempt-*.return.json"))
        previous = None
        for returned in returns:
            value = self.record_file(returned)
            require(value["requestSha256"] == digest(canonical(request)),
                    "Original response does not belong to this request.")
            if value.get("body"):
                self.read_descriptor(value["body"])
            start = directory / ("attempt-%06d.intent.json" % value["attempt"])
            self.record_file(start)
            previous = value
            if value["outcome"] == "SUCCESS":
                data = self.read_descriptor(value["body"])
                return (value["body"], data if binary else decode_json(data))
        if previous is not None:
            require(not previous.get("retryDeadlineUnrepresentable", False),
                    "Original provider retry deadline cannot be represented; reconcile it before another read.")
            deadline = previous.get("retryNotBeforeEpoch")
            require(deadline is None or time.time() >= deadline,
                    "Original provider retry deadline is still active.")
            if not self.retry_failed:
                raise CaptureFailure("Original failed read is retained; use --retry-failed to repeat it explicitly.",
                                     status=previous["status"], outcome=previous["outcome"])
        attempts = sorted(directory.glob("attempt-*.intent.json"))
        for path in attempts:
            self.record_file(path)
        attempt = max([int(path.name.split("-")[1].split(".")[0]) for path in attempts] or [0]) + 1
        self.requests += 1
        require(self.requests <= MAX_REQUESTS, "Request admission budget reached.")
        started = {"attempt": attempt, "requestSha256": digest(canonical(request)),
                   "startedAt": now(), "priorAttemptUnreturned": len(attempts) > len(returns)}
        start_path = directory / ("attempt-%06d.intent.json" % attempt)
        atomic(start_path, canonical(started), immutable=True)
        self.record_file(start_path)
        encoded = urllib.parse.urlencode(parameters).encode("ascii")
        headers = {"User-Agent": "Geocove-Highway-ReadOnly-Capture/1",
                   "Accept": "*/*" if binary else "application/json"}
        if self.token:
            headers["X-Esri-Authorization"] = "Bearer " + self.token
        if method == "GET":
            target = url + (("?" + encoded.decode()) if encoded else "")
            body = None
        else:
            target, body = url, encoded
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(target, data=body, headers=headers, method=method)
        returned = dict(started, returnedAt=None, outcome="TRANSPORT_ERROR", status=None, body=None,
                        retryNotBeforeEpoch=None, retryDeadlineUnrepresentable=False)
        response = None
        try:
            try:
                response = self.opener.open(req, timeout=60)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                returned["status"] = response.status
                returned["retryNotBeforeEpoch"], returned["retryDeadlineUnrepresentable"] = self.not_before(response.headers)
                limit = MAX_ATTACHMENT if binary else MAX_JSON
                remaining = self.binding["limits"]["maxBytes"] - self.total
                limit = min(limit, remaining)
                raw = response.read(limit + 1)
                require(len(raw) <= limit, "Original response exceeds capture budget; nothing was truncated into a success.")
                content_type = response.headers.get_content_type()
                returned["body"] = self.retain(raw, content_type)
                returned["outcome"] = "HTTP_ERROR"
                if 200 <= response.status < 300:
                    if binary:
                        # A JSON ArcGIS error may arrive with HTTP 200.
                        if content_type == "application/json":
                            parsed = decode_json(raw)
                            require(not isinstance(parsed, dict) or "error" not in parsed,
                                    "Attachment response contains an ArcGIS error.")
                        returned["outcome"] = "SUCCESS"
                    else:
                        parsed = decode_json(raw)
                        require(isinstance(parsed, dict), "Original ArcGIS response must be an object.")
                        returned["outcome"] = "ARCGIS_ERROR" if "error" in parsed else "SUCCESS"
        except Exception as error:
            # Avoid URLs/header values/exception text that might disclose credentials.
            returned["errorType"] = type(error).__name__
        finally:
            returned["returnedAt"] = now()
            return_path = directory / ("attempt-%06d.return.json" % attempt)
            atomic(return_path, canonical(returned), immutable=True)
            self.record_file(return_path)
        if returned["outcome"] != "SUCCESS":
            raise CaptureFailure("Original read did not succeed: " + key + "; inspect its retained request/result.",
                                 status=returned["status"], outcome=returned["outcome"])
        data = self.read_descriptor(returned["body"])
        return returned["body"], data if binary else decode_json(data)


def read_ids(receiver, prefix, dataset_id):
    count_desc, counted = receiver.request(prefix + "-count", "/%d/query" % dataset_id,
                                           {"where": "1=1", "returnCountOnly": "true", "f": "json"})
    require(type(counted.get("count")) is int and counted["count"] >= 0, "No original feature count.")
    require(counted["count"] <= receiver.binding["limits"]["maxFeatures"], "Feature limit exceeded.")
    descriptor, value = receiver.request(prefix + "-ids", "/%d/query" % dataset_id,
                                         {"where": "1=1", "returnIdsOnly": "true", "f": "json"})
    require(value.get("exceededTransferLimit") is not True, "ObjectID enumeration was truncated.")
    values = ids(value.get("objectIds"))
    require(len(values) <= receiver.binding["limits"]["maxFeatures"], "ObjectID limit exceeded.")
    return descriptor, value, values, count_desc, counted["count"]


def complete_dataset(receiver, dataset_id, kind):
    prefix = str(dataset_id)
    meta_desc, meta = receiver.request(prefix + "-metadata-initial", "/" + prefix, {"f": "json"})
    require(meta.get("id") == dataset_id and isinstance(meta.get("fields"), list),
            "Dataset metadata does not identify the selected dataset.")
    object_field = meta.get("objectIdField")
    if not object_field:
        candidates = [field["name"] for field in meta["fields"] if field.get("type") == "esriFieldTypeOID"]
        require(len(candidates) == 1, "No unambiguous native ObjectID field.")
        object_field = candidates[0]
    require(isinstance(object_field, str), "No original ObjectID field name.")
    id_desc, id_body, initial, count_desc, initial_count = read_ids(receiver, prefix + "-initial", dataset_id)
    require(not id_body.get("objectIdFieldName") or id_body["objectIdFieldName"] == object_field,
            "ObjectID field changed between original metadata and enumeration.")
    receiver.feature_total += len(initial)
    require(receiver.feature_total <= receiver.binding["limits"]["maxFeatures"],
            "Selected datasets exceed the aggregate feature budget.")
    max_records = meta.get("maxRecordCount")
    batch = receiver.binding["limits"]["batchSize"]
    if type(max_records) is int and max_records > 0:
        batch = min(batch, max_records)
    pages, seen, duplicates, feature_globals, observations = [], set(), set(), {}, []
    for offset in range(0, len(initial), batch):
        wanted = initial[offset:offset + batch]
        descriptor, page = receiver.request(prefix + "-features-%08d" % offset, "/" + prefix + "/query",
            {"objectIds": ",".join(map(str, wanted)), "outFields": "*",
             "returnGeometry": "true" if kind == "layer" else "false",
             "returnZ": "true", "returnM": "true", "f": "json"})
        pages.append(descriptor)
        require(isinstance(page.get("features"), list), "Original feature page has no features array.")
        if page.get("exceededTransferLimit") is True:
            observations.append({"code": "FEATURE_PAGE_TRANSFER_LIMIT", "offset": offset})
        for feature in page["features"]:
            require(isinstance(feature, dict) and isinstance(feature.get("attributes"), dict),
                    "Invalid original feature row.")
            identity = oid(feature["attributes"].get(object_field))
            if identity in seen:
                duplicates.add(identity)
            seen.add(identity)
            global_field = meta.get("globalIdField")
            feature_globals[identity] = feature["attributes"].get(global_field) if global_field else None
    expected = set(initial)
    attachments, manifests = [], []
    if meta.get("hasAttachments") is True:
        for identity in sorted(seen & expected):
            info_desc, listing = receiver.request(prefix + "-attachment-list-" + str(identity),
                "/%d/%d/attachments" % (dataset_id, identity), {"f": "json"})
            manifests.append({"parentObjectId": identity, "descriptor": info_desc})
            require(isinstance(listing.get("attachmentInfos"), list), "No original attachment listing.")
            if listing.get("exceededTransferLimit") is True:
                observations.append({"code": "ATTACHMENT_LIST_TRANSFER_LIMIT", "parentObjectId": identity})
            attachment_ids = set()
            for info in listing["attachmentInfos"]:
                require(isinstance(info, dict), "Invalid original attachment info.")
                attachment_id = oid(info.get("id"))
                require(attachment_id not in attachment_ids, "Duplicate attachment ID in original listing.")
                attachment_ids.add(attachment_id)
                receiver.attachment_total += 1
                require(receiver.attachment_total <= receiver.binding["limits"]["maxAttachments"],
                        "Aggregate attachment limit reached.")
                row = {"parentObjectId": identity, "parentGlobalId": feature_globals.get(identity),
                       "info": info, "content": None, "state": "UNAVAILABLE"}
                try:
                    content, raw = receiver.request(prefix + "-attachment-%d-%d" % (identity, attachment_id),
                        "/%d/%d/attachments/%d" % (dataset_id, identity, attachment_id), binary=True)
                    size = info.get("size")
                    require(type(size) is int and size >= 0 and size == len(raw),
                            "Attachment bytes differ from original listed size.")
                    row.update(content=content, state="CAPTURED")
                except CaptureFailure as error:
                    if error.status not in (404, 410):
                        raise
                    observations.append({"code": "ATTACHMENT_UNAVAILABLE", "parentObjectId": identity,
                                         "attachmentId": attachment_id, "httpStatus": error.status})
                attachments.append(row)
    else:
        observations.append({"code": "ATTACHMENTS_NOT_ADVERTISED", "hasAttachments": meta.get("hasAttachments")})
    final_id_desc, final_id_body, final_ids, final_count_desc, final_count = read_ids(
        receiver, prefix + "-final", dataset_id)
    final_meta_desc, final_meta = receiver.request(prefix + "-metadata-final", "/" + prefix, {"f": "json"})
    require(final_meta.get("id") == dataset_id, "Final metadata changed dataset identity.")
    changed = (initial != final_ids or canonical(meta) != canonical(final_meta) or initial_count != final_count
               or any(row["state"] == "UNAVAILABLE" for row in attachments))
    if initial_count != len(initial) or final_count != len(final_ids):
        observations.append({"code": "COUNT_ID_ENUMERATION_DISAGREEMENT",
                             "initialCount": initial_count, "initialIds": len(initial),
                             "finalCount": final_count, "finalIds": len(final_ids)})
        changed = True
    if changed:
        observations.append({"code": "SOURCE_CHANGED_DURING_CAPTURE"})
    observations.append({"code": "MULTIPLE_READS_NOT_TRANSACTIONAL_SNAPSHOT"})
    missing, unexpected = sorted(expected - seen), sorted(seen - expected)
    unavailable = sum(row["state"] != "CAPTURED" for row in attachments)
    limited = any(row["code"].endswith("TRANSFER_LIMIT") for row in observations)
    coverage = {"initialObjectIds": len(initial), "finalObjectIds": len(final_ids),
                "capturedFeatures": len(seen), "missingObjectIds": missing,
                "unexpectedObjectIds": unexpected, "duplicateObjectIds": sorted(duplicates),
                "initialReportedCount": initial_count, "finalReportedCount": final_count,
                "attachments": {"listed": len(attachments), "captured": len(attachments) - unavailable,
                                "unavailable": unavailable},
                "complete": not (missing or unexpected or duplicates or unavailable or limited or
                                  initial_count != len(initial) or final_count != len(final_ids)),
                "sourceChanged": changed}
    return {"id": dataset_id, "name": meta.get("name"), "type": kind, "metadata": meta_desc,
            "finalMetadata": final_meta_desc, "idQuery": id_desc, "finalIdQuery": final_id_desc,
            "countQuery": count_desc, "finalCountQuery": final_count_desc,
            "featurePages": pages, "attachmentManifests": manifests, "attachments": attachments,
            "coverage": coverage, "observations": observations}


def capture(service, layer_ids, table_ids, directory, *, operation_id, capture_id,
            token_env=None, batch_size=100, max_bytes=268435456, max_features=100000,
            max_attachments=10000, retry_failed=False):
    """Return the immutable manifest; reuse exactly the same inputs to resume reads."""
    service = service_url(service)
    operation_id, capture_id = identifier(operation_id), identifier(capture_id)
    layers, tables = ids(layer_ids), ids(table_ids)
    require(1 <= len(layers) + len(tables) and len(layers) <= 4 and len(tables) <= 2
            and not set(layers).intersection(tables), "Select up to four layers and two distinct tables.")
    require(type(batch_size) is int and 1 <= batch_size <= 1000, "Invalid feature batch size.")
    require(type(max_bytes) is int and 1024 <= max_bytes <= 1024 * 1024 * 1024, "Invalid byte bound.")
    require(type(max_features) is int and 1 <= max_features <= 100000, "Invalid aggregate feature bound.")
    require(type(max_attachments) is int and 0 <= max_attachments <= 10000, "Invalid attachment bound.")
    require(token_env is None or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", token_env),
            "Select only an environment variable name for an optional token.")
    token = os.environ.get(token_env) if token_env else None
    require(not token_env or token, "Selected token environment is absent.")
    require(not token or not re.search(r"[\r\n]", token), "Invalid credential header.")
    root = Path(directory).absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(root.resolve() == root and root.is_dir() and not root.is_symlink()
            and not (root.stat().st_mode & 0o077), "Capture directory must be a private real directory.")
    lock_fd = os.open(root / "capture.lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        require(stat.S_ISREG(os.fstat(lock_fd).st_mode), "Invalid capture lock.")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        binding = {"schema": SCHEMA, "id": capture_id, "operationId": operation_id,
                   "serviceUrl": service, "selection": {"layers": layers, "tables": tables},
                   "tokenEnv": token_env, "limits": {"batchSize": batch_size, "maxBytes": max_bytes,
                       "maxFeatures": max_features, "maxAttachments": max_attachments}}
        intent_path = root / "capture-intent.json"
        if intent_path.exists():
            intent = decode_json(regular_bytes(intent_path, MAX_JSON))
            require(intent["input"] == binding, "Resume the exact original capture and source selection.")
        else:
            intent = {"input": binding, "createdAt": now(), "startedAt": now()}
            atomic(intent_path, canonical(intent), immutable=True)
        receiver = Receiver(root, binding, token, retry_failed)
        receiver.feature_total = receiver.attachment_total = 0
        manifest_path = root / "manifest.json"
        if manifest_path.exists():
            result = decode_json(regular_bytes(manifest_path, MAX_JSON))
            require(result.get("schema") == SCHEMA and result.get("id") == capture_id
                    and result.get("operationId") == operation_id, "Completed capture identity changed.")
            unsigned = {key: value for key, value in result.items() if key != "sha256"}
            require(digest(canonical(unsigned)) == result.get("sha256"), "Completed manifest hash changed.")
            for descriptor in result["files"]:
                receiver.read_descriptor(descriptor)
            require(receiver.total == result["bytes"], "Completed capture byte inventory changed.")
            return result
        receiver.record_file(intent_path)
        meta_desc, meta = receiver.request("service-metadata-initial", "", {"f": "json"})
        advertised = {"layers": meta.get("layers"), "tables": meta.get("tables")}
        for kind, chosen in (("layers", layers), ("tables", tables)):
            require(isinstance(advertised[kind], list), "Service lacks the original " + kind + " inventory.")
            allowed = {row["id"] for row in advertised[kind]}
            require(set(chosen) <= allowed, "Selection contains an unadvertised dataset.")
        datasets = [complete_dataset(receiver, identity, kind)
                    for kind, selection in (("layer", layers), ("table", tables))
                    for identity in selection]
        final_desc, final_meta = receiver.request("service-metadata-final", "", {"f": "json"})
        observations = [{"code": "READ_ONLY_CAPTURE_NO_GIS_EDITS"},
                        {"code": "CAPABILITIES_RETAINED_FROM_ORIGINAL_METADATA"}]
        service_changed = canonical(meta) != canonical(final_meta)
        if service_changed:
            observations.append({"code": "SERVICE_METADATA_CHANGED_DURING_CAPTURE"})
        # Freeze completion time before publishing the manifest so resumed publication is exact.
        complete_path = root / "capture-completion.json"
        if complete_path.exists():
            completion = receiver.record_file(complete_path)
        else:
            completion = {"completedAt": now(), "id": capture_id, "operationId": operation_id}
            atomic(complete_path, canonical(completion), immutable=True)
            receiver.record_file(complete_path)
        result = {"schema": SCHEMA, "id": capture_id, "operationId": operation_id,
                  "createdAt": intent["createdAt"], "startedAt": intent["startedAt"],
                  "completedAt": completion["completedAt"],
                  "service": {"url": service, "itemId": meta.get("serviceItemId"),
                              "metadata": meta_desc, "finalMetadata": final_desc},
                  "selection": binding["selection"], "datasets": datasets,
                  "coverage": {"complete": all(row["coverage"]["complete"] for row in datasets),
                               "sourceChanged": service_changed or any(row["coverage"]["sourceChanged"] for row in datasets)},
                  "observations": observations,
                  "files": sorted(receiver.files.values(), key=lambda row: row["path"]),
                  "bytes": receiver.total}
        result["sha256"] = digest(canonical(result))
        atomic(manifest_path, canonical(result), immutable=True)
        return result
    finally:
        os.close(lock_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", required=True)
    parser.add_argument("--layers", default="")
    parser.add_argument("--tables", default="")
    parser.add_argument("--directory", required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--capture-id", required=True)
    parser.add_argument("--token-env")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--max-bytes", type=int, default=268435456)
    parser.add_argument("--max-features", type=int, default=100000)
    parser.add_argument("--max-attachments", type=int, default=10000)
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    result = capture(args.service, [int(v) for v in args.layers.split(",") if v],
                     [int(v) for v in args.tables.split(",") if v], args.directory,
                     operation_id=args.operation_id, capture_id=args.capture_id,
                     token_env=args.token_env, batch_size=args.batch_size, max_bytes=args.max_bytes,
                     max_features=args.max_features, max_attachments=args.max_attachments,
                     retry_failed=args.retry_failed)
    print(json.dumps({"schema": result["schema"], "id": result["id"], "sha256": result["sha256"],
                      "coverage": result["coverage"], "bytes": result["bytes"],
                      "manifest": str(Path(args.directory).absolute() / "manifest.json")}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"state": "INTERRUPTED", "errorType": type(error).__name__,
                          "detail": str(error) if isinstance(error, (ValueError, CaptureFailure)) else
                          "Original read failed; retain this capture directory and inspect its records."}), file=sys.stderr)
        raise SystemExit(2)

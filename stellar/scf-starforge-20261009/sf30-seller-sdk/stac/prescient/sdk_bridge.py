#!/usr/bin/env python3
"""Private original-SDK worker and durable exact-object S3 receiving.

Prescient owns identity and temporary credentials. A receiving spool preserves
one reviewed workspace operation across capture attempts and process restarts.
stdout is a private NDJSON protocol. Run through sdk-runtime.mjs.
"""
from __future__ import annotations

import base64
import contextlib
import datetime as dt
import fcntl
import hashlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

SDK_COMMIT = "895b7720b22c3047b76ecff512f6be13f1d62fc9"
SDK_HASHES = {
    "client": "2c4524d18a5f4ff442e6c2248082fc4e873ee0b001cd17af6ab362db4780c87e",
    "config": "40c9607160edf2da193f6cd0fb3eaf5bdd9e6418423d76bdf3a6f76acca846a1",
}
MAX_PROTOCOL_BYTES = 8 * 1024 * 1024
MAX_ASSET_BYTES = 2 * 1024**3
EXPIRED_CODES = {"ExpiredToken", "ExpiredTokenException", "TokenRefreshRequired"}


class BridgeError(Exception):
    def __init__(self, code: str, **details):
        super().__init__(code)
        self.code, self.details = code, details


def require(value, code):
    if not value:
        raise BridgeError(code)


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def timestamp(value=None):
    return (value or utcnow()).isoformat().replace("+00:00", "Z")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest_file(path, limit=None):
    digest, size = hashlib.sha256(), 0
    with Path(path).open("rb") as stream:
        while limit is None or size < limit:
            chunk = stream.read(min(1024 * 1024, limit - size) if limit is not None else 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
    return size, digest.hexdigest()


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def durable_directory(path):
    """Persist each newly created directory entry before its first checkpoint."""
    path = Path(path)
    missing, cursor = [], path
    while not cursor.exists():
        missing.append(cursor)
        cursor = cursor.parent
    require(cursor.is_dir(), "PRESCIENT_PRIVATE_ROOT_INVALID")
    # A prior process may have created this entry before syncing its parent.
    sync_directory(cursor)
    sync_directory(cursor.parent)
    for directory in reversed(missing):
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            require(directory.is_dir(), "PRESCIENT_PRIVATE_ROOT_INVALID")
        sync_directory(directory)
        sync_directory(directory.parent)
    require(path.is_dir(), "PRESCIENT_PRIVATE_ROOT_INVALID")


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(canonical(value) + b"\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    sync_directory(path.parent)


def origin(url):
    try:
        selected = urlsplit(url)
        require(selected.scheme == "https" and selected.hostname and selected.port in (None, 443),
                "PRESCIENT_HTTPS_ORIGIN_REQUIRED")
        require(selected.username is None and selected.password is None and not selected.fragment,
                "PRESCIENT_URL_INVALID")
        return "https://" + selected.hostname.encode("idna").decode("ascii").lower()
    except (ValueError, UnicodeError, TypeError):
        raise BridgeError("PRESCIENT_URL_INVALID") from None


def normalize_config(config):
    require(isinstance(config, dict), "PRESCIENT_CONFIGURATION_REQUIRED")
    result = dict(config)
    require(result.get("authMode") in ("api-key", "oauth"), "PRESCIENT_AUTH_MODE_REQUIRED")
    require(result.get("expectedIdentityProvider") is None or result["expectedIdentityProvider"] in ("microsoft", "google"),
            "PRESCIENT_IDENTITY_PROVIDER_INVALID")
    endpoint = result.get("expectedEndpoint")
    origin(endpoint)
    require(isinstance(result.get("allowedOrigins"), list) and result["allowedOrigins"],
            "PRESCIENT_ALLOWED_ORIGINS_REQUIRED")
    result["allowedOrigins"] = sorted(set(origin(value) for value in result["allowedOrigins"]))
    require(origin(endpoint) in result["allowedOrigins"], "PRESCIENT_ENDPOINT_ORIGIN_NOT_APPROVED")
    if result.get("envFile"):
        require(Path(result["envFile"]).is_absolute() and Path(result["envFile"]).is_file(),
                "PRESCIENT_ENV_FILE_REQUIRED")
    for name in ("receivingRoot", "captureRoot"):
        require(isinstance(result.get(name), str) and Path(result[name]).is_absolute(),
                "PRESCIENT_PRIVATE_ROOT_REQUIRED")
        result[name] = str(Path(result[name]).resolve())
    require(result["receivingRoot"] != result["captureRoot"], "PRESCIENT_DISTINCT_ROOTS_REQUIRED")
    require(isinstance(result.get("allowedS3"), list), "PRESCIENT_S3_APPROVALS_REQUIRED")
    for rule in result["allowedS3"]:
        require(isinstance(rule, dict) and isinstance(rule.get("bucket"), str)
                and re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", rule["bucket"]),
                "PRESCIENT_S3_BUCKET_INVALID")
        require(isinstance(rule.get("prefix"), str) and isinstance(rule.get("region"), str)
                and re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d+", rule["region"]), "PRESCIENT_S3_SCOPE_REQUIRED")
        require(rule.get("expectedBucketOwner") is None or isinstance(rule["expectedBucketOwner"], str)
                and re.fullmatch(r"\d{12}", rule["expectedBucketOwner"]), "PRESCIENT_BUCKET_OWNER_INVALID")
        require(type(rule.get("requesterPays", False)) is bool, "PRESCIENT_REQUESTER_PAYS_INVALID")
    for name, default, minimum, maximum in (
        ("refreshSkewSeconds", 120, 0, 900), ("chunkBytes", 8 * 1024**2, 16384, 64 * 1024**2),
        ("connectTimeoutSeconds", 10, 1, 120), ("readTimeoutSeconds", 60, 1, 900),
    ):
        value = result.get(name, default)
        require(type(value) is int and minimum <= value <= maximum, "PRESCIENT_RUNTIME_LIMIT_INVALID")
        result[name] = value
    return result


class PrescientSession:
    """Use the installed original SDK's public client, Settings and session API."""
    def __init__(self, config):
        from prescient_sdk.client import PrescientClient
        from prescient_sdk.config import Settings

        for name, symbol in (("client", PrescientClient), ("config", Settings)):
            actual = hashlib.sha256(Path(inspect.getfile(symbol)).read_bytes()).hexdigest()
            require(actual == SDK_HASHES[name], "PRESCIENT_SDK_SOURCE_PIN_MISMATCH")
        self.config, self.client_type = config, PrescientClient
        self.client = PrescientClient(env_file=config.get("envFile"))
        self.settings = self.client.settings.model_copy(deep=True)
        require(self.settings.prescient_endpoint_url == config["expectedEndpoint"],
                "PRESCIENT_EFFECTIVE_ENDPOINT_MISMATCH")
        require(bool(self.settings.prescient_api_key) == (config["authMode"] == "api-key"),
                "PRESCIENT_EFFECTIVE_AUTH_MODE_MISMATCH")
        provider = self.settings.prescient_auth_provider if config["authMode"] == "oauth" else None
        require(config["authMode"] != "oauth" or config.get("expectedIdentityProvider") is None
                or provider == config["expectedIdentityProvider"], "PRESCIENT_EFFECTIVE_IDENTITY_PROVIDER_MISMATCH")
        require(origin(self.client.stac_catalog_url) in config["allowedOrigins"],
                "PRESCIENT_CATALOG_ORIGIN_NOT_APPROVED")
        self.expiration, self.native_session, self.generation = None, None, 0
        self.clients, self.invalidated = {}, False
        try:
            version = importlib.metadata.version("prescient-sdk")
        except importlib.metadata.PackageNotFoundError:
            version = None
        self.metadata = {
            "schema": "prescient-sdk-runtime/v1", "sdkCommit": SDK_COMMIT,
            "sdkSourceHashes": SDK_HASHES, "installedVersion": version,
            "endpoint": config["expectedEndpoint"], "catalogUrl": self.client.stac_catalog_url,
            "authMode": config["authMode"], "identityProvider": provider, "allowedOrigins": config["allowedOrigins"],
        }

    def _discard_session(self):
        for client in self.clients.values():
            client.close()
        self.clients.clear()
        self.native_session, self.expiration = None, None

    def _refresh(self):
        self._discard_session()
        if self.config["authMode"] == "api-key":
            # 0.4.2 treats API keys as static; refresh_credentials returns without
            # renewing fileproxy credentials. Reuse frozen Settings in a fresh
            # original client instead of modifying its private credential cache.
            self.client = self.client_type(settings=self.settings.model_copy(deep=True))
        else:
            self.client.refresh_credentials(force=True)
        self.invalidated = False

    def request_headers(self, params):
        require(origin(params.get("url")) in self.config["allowedOrigins"],
                "PRESCIENT_SOURCE_ORIGIN_NOT_APPROVED")
        require(params.get("method", "GET").upper() in ("GET", "HEAD", "POST"),
                "PRESCIENT_SOURCE_METHOD_NOT_APPROVED")
        if self.invalidated:
            require(self.config["authMode"] == "oauth", "PRESCIENT_API_KEY_UPDATE_REQUIRED")
            self._refresh()
        headers = {key.lower(): value for key, value in self.client.headers.items()}
        selected = "api-key" if self.config["authMode"] == "api-key" else "authorization"
        value = headers.get(selected)
        require(isinstance(value, str) and value and "\r" not in value and "\n" not in value,
                "PRESCIENT_NATIVE_AUTH_HEADER_INVALID")
        return {selected: value}

    def observe_response(self, params):
        require(origin(params.get("url")) in self.config["allowedOrigins"],
                "PRESCIENT_SOURCE_ORIGIN_NOT_APPROVED")
        if params.get("status") == 401:
            self.invalidated = True
        return {"authMode": self.config["authMode"],
                "renewalRequired": self.invalidated and self.config["authMode"] == "oauth",
                "credentialUpdateRequired": self.invalidated and self.config["authMode"] == "api-key"}

    def session_metadata(self):
        """A non-network snapshot, including after the last received byte."""
        return {"mode": "prescient", "authMode": self.config["authMode"], "generation": self.generation,
                "expiresAt": timestamp(self.expiration) if self.expiration is not None else None}

    def session_status(self, refresh=False):
        require(not self.invalidated or self.config["authMode"] == "oauth", "PRESCIENT_API_KEY_UPDATE_REQUIRED")
        if refresh:
            self._refresh()
        if self.native_session is not None and (self.invalidated or
                self.expiration <= utcnow() + dt.timedelta(seconds=self.config["refreshSkewSeconds"])):
            self._refresh()
        if self.native_session is None:
            credentials = self.client.bucket_credentials
            expiration = credentials.get("Expiration")
            if isinstance(expiration, str):
                expiration = dt.datetime.fromisoformat(expiration.replace("Z", "+00:00"))
            require(isinstance(expiration, dt.datetime) and expiration.tzinfo is not None,
                    "PRESCIENT_NATIVE_SESSION_EXPIRATION_REQUIRED")
            require(expiration > utcnow(), "PRESCIENT_NATIVE_SESSION_ALREADY_EXPIRED")
            self.native_session = self.client.session
            self.expiration = expiration.astimezone(dt.timezone.utc)
            self.generation += 1
        return self.session_metadata()

    def s3_client(self, region):
        from botocore.config import Config

        self.session_status()
        if region not in self.clients:
            self.clients[region] = self.native_session.client("s3", region_name=region, config=Config(
                connect_timeout=self.config["connectTimeoutSeconds"],
                read_timeout=self.config["readTimeoutSeconds"],
                retries={"mode": "standard", "total_max_attempts": 3},
            ))
        return self.clients[region]

    def close(self):
        self._discard_session()


def selected_object(descriptor, config):
    require(isinstance(descriptor, dict) and isinstance(descriptor.get("href"), str),
            "PRESCIENT_ASSET_DESCRIPTOR_REQUIRED")
    require(not descriptor.get("storage", {}).get("missingSchemes"), "PRESCIENT_STORAGE_SCHEME_UNRESOLVED")
    href = descriptor["href"]
    try:
        selected = urlsplit(href)
        require(not selected.fragment and selected.username is None and selected.password is None
                and selected.path.startswith("/") and selected.path != "/", "PRESCIENT_S3_URL_INVALID")
        region = None
        if selected.scheme == "s3":
            require(selected.port is None, "PRESCIENT_S3_URL_INVALID")
            bucket = selected.hostname
        elif selected.scheme == "https":
            require(selected.port in (None, 443), "PRESCIENT_S3_URL_INVALID")
            match = re.fullmatch(r"(.+)\.s3\.([a-z]{2}(?:-[a-z]+)+-\d+)\.amazonaws\.com", selected.hostname or "")
            require(match, "PRESCIENT_S3_URL_UNSUPPORTED")
            bucket, region = match.groups()
        else:
            raise BridgeError("PRESCIENT_S3_URL_UNSUPPORTED")
        require(not re.search(r"%(?![0-9a-fA-F]{2})", selected.path), "PRESCIENT_S3_KEY_ENCODING_INVALID")
        key = unquote(selected.path[1:], encoding="utf-8", errors="strict")
        require(key and "\x00" not in key, "PRESCIENT_S3_KEY_INVALID")
        query = parse_qsl(selected.query, keep_blank_values=True, strict_parsing=True)
        require(len(query) <= 1 and all(name == "versionId" and value for name, value in query),
                "PRESCIENT_S3_QUERY_NOT_APPROVED")
        version = query[0][1] if query else None
    except (ValueError, UnicodeError, TypeError):
        raise BridgeError("PRESCIENT_S3_URL_INVALID") from None
    candidates = [rule for rule in config["allowedS3"] if rule["bucket"] == bucket
                  and key.startswith(rule["prefix"]) and (region is None or region == rule["region"])]
    require(candidates, "PRESCIENT_S3_OBJECT_NOT_APPROVED")
    candidates.sort(key=lambda rule: len(rule["prefix"]), reverse=True)
    scope = candidates[0]
    require(all(rule == scope for rule in candidates if len(rule["prefix"]) == len(scope["prefix"])),
            "PRESCIENT_S3_SCOPE_AMBIGUOUS")
    require(not descriptor.get("requesterPays") or scope.get("requesterPays") is True,
            "PRESCIENT_REQUESTER_PAYS_APPROVAL_REQUIRED")
    return {"originalHref": href, "bucket": bucket, "key": key, "region": scope["region"],
            "versionId": version, "expectedBucketOwner": scope.get("expectedBucketOwner"),
            "requesterPays": scope.get("requesterPays", False)}


def aws_error(error):
    response = getattr(error, "response", None)
    if not isinstance(response, dict):
        return None
    code = response.get("Error", {}).get("Code", "Unknown")
    metadata = response.get("ResponseMetadata", {})
    return {"awsCode": code if isinstance(code, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", code) else "Unknown",
            "httpStatus": metadata.get("HTTPStatusCode"), "requestId": metadata.get("RequestId")}


class S3Receiver:
    """A session provider supplies real boto3 clients; it never supplies file bytes."""
    def __init__(self, config, sessions, on_progress=None):
        self.config, self.sessions, self.on_progress = config, sessions, on_progress

    def _call(self, source, method, arguments):
        for attempt in range(2):
            try:
                client = self.sessions.s3_client(source["region"])
                return getattr(client, method)(**arguments)
            except BridgeError:
                raise
            except Exception as error:
                details = aws_error(error)
                if details and details["awsCode"] in EXPIRED_CODES and attempt == 0:
                    self.sessions.session_status(refresh=True)
                    continue
                if details:
                    code = "PRESCIENT_S3_OBJECT_CHANGED" if details["httpStatus"] == 412 else "PRESCIENT_S3_REQUEST_FAILED"
                    raise BridgeError(code, **details) from None
                raise BridgeError("PRESCIENT_S3_CONNECTION_FAILED") from None

    def download(self, params):
        descriptor, selection = params.get("descriptor"), params.get("selection")
        require(isinstance(selection, dict) and all(isinstance(selection.get(name), str) and selection[name]
                for name in ("workspaceId", "reviewId", "itemDigest", "operationId")),
                "PRESCIENT_ORIGINAL_SELECTION_REQUIRED")
        require(re.fullmatch(r"[a-f0-9]{64}", selection["itemDigest"]), "PRESCIENT_ITEM_DIGEST_INVALID")
        limit = params.get("maxBytes")
        require(type(limit) is int and 0 < limit <= MAX_ASSET_BYTES, "PRESCIENT_ASSET_BYTE_LIMIT_REQUIRED")
        source = selected_object(descriptor, self.config)
        capture_root = Path(self.config["captureRoot"]).resolve()
        require(isinstance(params.get("directory"), str), "PRESCIENT_CAPTURE_DIRECTORY_REQUIRED")
        destination = Path(params["directory"]).resolve()
        require(destination != capture_root and capture_root in destination.parents and destination.is_dir(),
                "PRESCIENT_CAPTURE_DIRECTORY_NOT_APPROVED")
        selected = {"schema": "prescient-selected-s3/v1", "selection": {key: selection[key] for key in
                    ("workspaceId", "reviewId", "itemDigest", "operationId")},
                    "source": source, "maxBytes": limit, "sdkCommit": SDK_COMMIT}
        # The identity excludes mutable inputs deliberately. A changed review,
        # source or limit under the original operation conflicts with its journal
        # instead of silently starting a second receiving spool.
        identity = hashlib.sha256(canonical({"schema": "prescient-s3-operation/v1",
                    "workspaceId": selection["workspaceId"], "operationId": selection["operationId"]})).hexdigest()
        spool = Path(self.config["receivingRoot"]) / identity
        durable_directory(spool)
        lock = os.open(spool / "receive.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise BridgeError("PRESCIENT_RECEIVING_ALREADY_ACTIVE") from None
            return self._receive(spool, destination, selected, descriptor, identity)
        finally:
            os.close(lock)

    def _finish(self, spool, destination, journal, identity):
        complete, partial = spool / "object.bin", spool / "object.part"
        observed = journal["object"]
        expected = (observed["bytes"], journal["prefixSha256"])
        if not complete.exists():
            require(partial.exists() and digest_file(partial) == expected, "PRESCIENT_RETAINED_ASSET_CHANGED")
            os.replace(partial, complete)
            sync_directory(spool)
        require(digest_file(complete) == expected, "PRESCIENT_RETAINED_ASSET_CHANGED")
        checksum = observed.get("sourceChecksumSha256")
        if checksum:
            require(base64.b64encode(bytes.fromhex(expected[1])).decode("ascii") == checksum,
                    "PRESCIENT_SOURCE_CHECKSUM_MISMATCH")
        completed_at = journal.get("completedAt") or timestamp()
        receipt = {"schema": "prescient-s3-receipt/v1", "receivingId": identity,
                   "selected": journal["selected"], "object": observed, "bytes": expected[0], "sha256": expected[1],
                   "startedAt": journal["startedAt"], "completedAt": completed_at,
                   "attempts": journal["attempts"], "chunks": journal["chunks"],
                   "session": journal.get("session"), "sourceChecksumSha256": checksum}
        record = {"status": 200, "headers": {"content-length": str(expected[0]),
                  "content-type": observed["mime"], "etag": observed["etag"]},
                  "bytes": expected[0], "sha256": expected[1], "mime": observed["mime"],
                  "completedAt": completed_at, "prescient": receipt}
        journal.update(phase="COMPLETE", bytes=expected[0], sha256=expected[1], completedAt=completed_at, record=record)
        journal.pop("lastError", None)
        write_json(spool / "receiving.json", journal)
        return self._publish(complete, destination, record, identity)

    def _receive(self, spool, destination, selected, descriptor, identity):
        journal_path, partial, complete = spool / "receiving.json", spool / "object.part", spool / "object.bin"
        source, limit = selected["source"], selected["maxBytes"]
        journal = json.loads(journal_path.read_text()) if journal_path.exists() else None
        if journal:
            require(isinstance(journal, dict) and journal.get("selected") == selected,
                    "PRESCIENT_RECEIVING_SELECTION_MISMATCH")
            require(journal.get("phase") in ("RECEIVING", "COMPLETE"), "PRESCIENT_RECEIVING_CHECKPOINT_INVALID")
            if journal["phase"] == "COMPLETE":
                require(digest_file(complete) == (journal["bytes"], journal["sha256"]),
                        "PRESCIENT_RETAINED_ASSET_CHANGED")
                sync_directory(spool)
                return self._publish(complete, destination, journal["record"], identity)
            # Every byte is already committed. Recover rename/journal/reply
            # interruptions offline, including an unavailable source or identity.
            if journal.get("committedBytes") == journal["object"]["bytes"] and (partial.exists() or complete.exists()):
                return self._finish(spool, destination, journal, identity)
        arguments = {"Bucket": source["bucket"], "Key": source["key"]}
        if source["versionId"]:
            arguments["VersionId"] = source["versionId"]
        if source["expectedBucketOwner"]:
            arguments["ExpectedBucketOwner"] = source["expectedBucketOwner"]
        if source["requesterPays"]:
            arguments["RequestPayer"] = "requester"
        try:
            head = self._call(source, "head_object", arguments)
            require(head.get("ResponseMetadata", {}).get("HTTPStatusCode") == 200, "PRESCIENT_S3_HEAD_STATUS_INVALID")
            length, etag = head.get("ContentLength"), head.get("ETag")
            require(type(length) is int and 0 <= length <= limit, "PRESCIENT_ASSET_SIZE_LIMIT")
            require(isinstance(etag, str) and etag, "PRESCIENT_S3_ETAG_REQUIRED")
            observed = {"bytes": length, "etag": etag, "versionId": head.get("VersionId"),
                        "mime": (head.get("ContentType") or descriptor.get("type") or "application/octet-stream").split(";")[0].strip().lower(),
                        "sourceChecksumSha256": head.get("ChecksumSHA256") if head.get("ChecksumType") == "FULL_OBJECT" else None}
            if source["versionId"]:
                require(observed["versionId"] == source["versionId"], "PRESCIENT_S3_VERSION_MISMATCH")
            if journal:
                require(journal["object"] == observed, "PRESCIENT_S3_OBJECT_CHANGED")
            else:
                journal = {"schema": "prescient-s3-receiving/v1", "selected": selected, "object": observed,
                           "phase": "RECEIVING", "committedBytes": 0, "prefixSha256": hashlib.sha256(b"").hexdigest(),
                           "startedAt": timestamp(), "attempts": 0, "chunks": 0}
                write_json(journal_path, journal)
            committed = journal["committedBytes"]
            require(type(committed) is int and 0 <= committed <= length, "PRESCIENT_RECEIVING_CHECKPOINT_INVALID")
            journal["attempts"] += 1
            journal["session"] = self.sessions.session_metadata()
            journal.pop("lastError", None)
            write_json(journal_path, journal)
            flags = os.O_RDWR | os.O_NOFOLLOW | (os.O_CREAT if committed == 0 else 0)
            file_descriptor = os.open(partial, flags, 0o600)
            with os.fdopen(file_descriptor, "r+b") as stream:
                require(os.fstat(stream.fileno()).st_size >= committed, "PRESCIENT_RECEIVING_PREFIX_MISSING")
                require(digest_file(partial, committed) == (committed, journal["prefixSha256"]),
                        "PRESCIENT_RECEIVING_PREFIX_CHANGED")
                # Only the fsynced prefix in receiving.json is committed. The
                # unfinished range tail is truncated, without changing selection.
                stream.truncate(committed)
                stream.flush()
                os.fsync(stream.fileno())
                digest = hashlib.sha256()
                stream.seek(0)
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                stream.seek(committed)
                while committed < length:
                    end = min(length, committed + self.config["chunkBytes"]) - 1
                    request = dict(arguments, Range=f"bytes={committed}-{end}", IfMatch=etag)
                    if observed["versionId"]:
                        request["VersionId"] = observed["versionId"]
                    response = self._call(source, "get_object", request)
                    body = response.get("Body")
                    try:
                        require(body is not None and response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 206,
                                "PRESCIENT_S3_RANGE_STATUS_INVALID")
                        require(response.get("ContentRange") == f"bytes {committed}-{end}/{length}"
                                and response.get("ContentLength") == end - committed + 1,
                                "PRESCIENT_S3_RANGE_MISMATCH")
                        require(response.get("ETag") == etag and response.get("VersionId") == observed["versionId"],
                                "PRESCIENT_S3_OBJECT_CHANGED")
                        remaining = end - committed + 1
                        while remaining:
                            data = body.read(min(1024 * 1024, remaining))
                            require(data and len(data) <= remaining, "PRESCIENT_S3_RANGE_TRUNCATED")
                            stream.write(data)
                            digest.update(data)
                            remaining -= len(data)
                        require(not body.read(1), "PRESCIENT_S3_RANGE_LENGTH_MISMATCH")
                    finally:
                        if body is not None:
                            body.close()
                    stream.flush()
                    os.fsync(stream.fileno())
                    committed = end + 1
                    journal.update(committedBytes=committed, prefixSha256=digest.hexdigest(),
                                   chunks=journal["chunks"] + 1, updatedAt=timestamp(),
                                   session=self.sessions.session_metadata())
                    write_json(journal_path, journal)
                    if self.on_progress:
                        self.on_progress({"receivingId": identity, "receivedBytes": committed, "totalBytes": length,
                                          "attempts": journal["attempts"], "session": journal["session"]})
            return self._finish(spool, destination, journal, identity)
        except Exception as error:
            if journal is not None:
                if isinstance(error, BridgeError):
                    code, details = error.code, error.details
                elif isinstance(error, OSError):
                    code, details = "PRESCIENT_RECEIVING_STORAGE_FAILED", {"errno": error.errno}
                else:
                    code, details = "PRESCIENT_RECEIVING_FAILED", {}
                journal["lastError"] = {"code": code, "details": details, "at": timestamp()}
                try:
                    write_json(journal_path, journal)
                except OSError:
                    pass  # Keep the prior atomic checkpoint on disk-full.
            if isinstance(error, BridgeError):
                raise
            if isinstance(error, OSError):
                raise BridgeError("PRESCIENT_RECEIVING_STORAGE_FAILED", errno=error.errno) from None
            raise BridgeError("PRESCIENT_RECEIVING_FAILED") from None

    def _publish(self, complete, destination, record, identity):
        final, staging = destination / "asset.bin", destination / (".prescient-" + identity + ".part")
        expected = (record["bytes"], record["sha256"])
        if final.exists():
            require(digest_file(final) == expected, "PRESCIENT_CAPTURE_ASSET_CONFLICT")
        else:
            descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "wb") as target, complete.open("rb") as source:
                shutil.copyfileobj(source, target, 1024 * 1024)
                target.flush()
                os.fsync(target.fileno())
            require(digest_file(staging) == expected, "PRESCIENT_CAPTURE_COPY_MISMATCH")
            try:
                os.link(staging, final)
            except FileExistsError:
                require(digest_file(final) == expected, "PRESCIENT_CAPTURE_ASSET_CONFLICT")
            staging.unlink()
            sync_directory(destination)
        receipt_path = destination / "prescient-receipt.json"
        if receipt_path.exists():
            require(json.loads(receipt_path.read_text()) == record["prescient"], "PRESCIENT_CAPTURE_RECEIPT_CONFLICT")
        else:
            write_json(receipt_path, record["prescient"])
        # Recovery may find both entries after a killed rename-before-fsync.
        sync_directory(destination)
        return record


def safe_error(error):
    if isinstance(error, BridgeError):
        return {"code": error.code, "message": error.code, "details": error.details}
    if isinstance(error, (ImportError, ModuleNotFoundError)):
        return {"code": "PRESCIENT_RUNTIME_DEPENDENCIES_MISSING", "message": "PRESCIENT_RUNTIME_DEPENDENCIES_MISSING"}
    if isinstance(error, OSError):
        return {"code": "PRESCIENT_RUNTIME_IO_FAILED", "message": "PRESCIENT_RUNTIME_IO_FAILED", "details": {"errno": error.errno}}
    status = getattr(getattr(error, "response", None), "status_code", None)
    if type(status) is int:
        code = "PRESCIENT_SOURCE_AUTHORIZATION_DENIED" if status in (401, 403) else "PRESCIENT_SOURCE_HTTP_FAILED"
        return {"code": code, "message": code, "details": {"httpStatus": status}}
    # Original SDK ValueErrors may contain complete identity-provider responses.
    return {"code": "PRESCIENT_NATIVE_OPERATION_FAILED", "message": "PRESCIENT_NATIVE_OPERATION_FAILED"}


def serve():
    output, sessions, config = sys.stdout, None, None

    def emit(value):
        output.write(canonical(value).decode("utf-8") + "\n")
        output.flush()

    try:
        with open(os.devnull, "w") as silent:
            while True:
                line = sys.stdin.buffer.readline(MAX_PROTOCOL_BYTES + 1)
                if not line:
                    return
                request = {}
                try:
                    require(len(line) <= MAX_PROTOCOL_BYTES and line.endswith(b"\n"), "PRESCIENT_PROTOCOL_LIMIT")
                    request = json.loads(line)
                    require(isinstance(request, dict) and isinstance(request.get("id"), str)
                            and len(request["id"]) <= 100, "PRESCIENT_PROTOCOL_INVALID")
                    method, params = request.get("method"), request.get("params", {})
                    require(isinstance(params, dict), "PRESCIENT_PROTOCOL_INVALID")
                    with contextlib.redirect_stdout(silent), contextlib.redirect_stderr(silent):
                        if method == "initialize":
                            require(sessions is None, "PRESCIENT_RUNTIME_ALREADY_INITIALIZED")
                            config = normalize_config(params.get("config"))
                            sessions = PrescientSession(config)
                            result = sessions.metadata
                        else:
                            require(sessions is not None, "PRESCIENT_RUNTIME_NOT_INITIALIZED")
                            if method == "requestHeaders":
                                result = sessions.request_headers(params)
                            elif method == "observeResponse":
                                result = sessions.observe_response(params)
                            elif method == "sessionStatus":
                                result = sessions.session_status(refresh=params.get("refresh") is True)
                            elif method == "reviewS3":
                                result = {"eligible": True, "eligibilityReason": "PRESCIENT_APPROVED_S3",
                                          "source": selected_object(params.get("descriptor"), config)}
                            elif method == "downloadS3":
                                receiver = S3Receiver(config, sessions, lambda value: emit({
                                    "id": request["id"], "event": "progress", "progress": value}))
                                result = receiver.download(params)
                            elif method == "close":
                                sessions.close()
                                emit({"id": request["id"], "result": {"closed": True}})
                                return
                            else:
                                raise BridgeError("PRESCIENT_PROTOCOL_METHOD_UNKNOWN")
                    emit({"id": request["id"], "result": result})
                except Exception as error:
                    emit({"id": request.get("id") if isinstance(request, dict) else None, "error": safe_error(error)})
    finally:
        if sessions is not None:
            sessions.close()


if __name__ == "__main__":
    serve()

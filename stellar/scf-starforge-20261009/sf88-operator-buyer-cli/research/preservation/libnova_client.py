#!/usr/bin/env python3
"""Durable receiving for an existing LIBNOVA container and BagIt Function.

Only run() performs entered provider writes. plan() is offline; refresh()
performs read-only reconciliation. Credentials are environment references.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import re
import ssl
import stat
import time
import urllib.error
import urllib.parse
import urllib.request

import libnova as package

SCHEMA = "stellar-forge.libnova-client.v1"
OP_SCHEMA = "stellar-forge.libnova-operation.v1"
SDK_COMMIT = "2e03d8ba3d10afe19f1bed450c68e77a188ad695"
BAGIT_FUNCTION_COMMIT = "f61b3e09d670f4a8fd49c415e5b628a335294870"
JSON_LIMIT = 16 * 1024 ** 2
ASSET_LIMIT = 32 * 1024 ** 2
MAX_OBJECTS = 30000
SECRET_FIELDS = {
    "authorization", "password", "api_key", "key_root", "key_user", "access_key",
    "secret_key", "session_token", "security_token", "function_input", "token",
}


class ReceivingPause(package.LibnovaError):
    def __init__(self, status, message, **details):
        super().__init__(message)
        self.status, self.details = status, details


def positive(value, name):
    if isinstance(value, bool):
        raise package.LibnovaError("Invalid " + name)
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise package.LibnovaError("Enter a positive integer " + name) from exc
    if str(result) != str(value) or result < 1:
        raise package.LibnovaError("Enter a positive integer " + name)
    return result


def origin(value, loopback=False):
    if not isinstance(value, str):
        raise package.LibnovaError("Enter an explicit provider origin")
    parsed = urllib.parse.urlsplit(value.rstrip("/"))
    local = parsed.hostname in {"127.0.0.1", "::1", "localhost"}
    if (parsed.scheme != "https" and not (loopback and local and parsed.scheme == "http")):
        raise package.LibnovaError("HTTPS is required; HTTP is limited to an explicitly entered loopback fixture")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise package.LibnovaError("Provider origin must not contain credentials, query or fragment")
    if parsed.path not in {"", "/"}:
        raise package.LibnovaError("Enter the platform origin without /api or an object path")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def env_name(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", value):
        raise package.LibnovaError("Enter an environment variable reference for " + label)
    return value


def configuration_template():
    return {
        "schema": SCHEMA, "baseUrl": "https://your-existing-platform.example",
        "tokenEnv": "LIBNOVA_API_TOKEN", "containerId": None, "storageId": None,
        "metadataSchemaId": None, "functionId": None,
        "objectPrefix": "reviewed-research",
        "s3": {"endpointUrl": "https://your-existing-s3-endpoint.example",
               "bucket": "your-existing-bucket", "region": "us-east-1",
               "accessKeyEnv": "LIBNOVA_S3_ACCESS_KEY",
               "secretKeyEnv": "LIBNOVA_S3_SECRET_KEY", "addressingStyle": "path"},
        "timeoutSeconds": 60, "indexWaitSeconds": 60, "jobWaitSeconds": 60,
        "pollSeconds": 1,
        "note": "Use existing container/schema/storage/Function IDs and matching authorized S3 "
                "credentials. No token or secret value belongs in this file."
    }


def normalize_configuration(value):
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise package.LibnovaError("Unsupported LIBNOVA client configuration")
    allowed = {"schema", "baseUrl", "tokenEnv", "containerId", "storageId", "metadataSchemaId",
               "functionId", "functionKey", "objectPrefix", "s3", "timeoutSeconds",
               "indexWaitSeconds", "jobWaitSeconds", "pollSeconds", "caFile",
               "allowLoopback", "note"}
    if set(value) - allowed:
        raise package.LibnovaError("Unknown client configuration properties")
    loopback = value.get("allowLoopback", False)
    if type(loopback) is not bool:
        raise package.LibnovaError("allowLoopback must be an explicit boolean")
    result = {"schema": SCHEMA, "baseUrl": origin(value.get("baseUrl"), loopback),
              "tokenEnv": env_name(value.get("tokenEnv", "LIBNOVA_API_TOKEN"), "API token")}
    for key in ("containerId", "storageId", "metadataSchemaId", "functionId"):
        result[key] = positive(value.get(key), key)
    prefix = package.safe(value.get("objectPrefix", "reviewed-research"))
    if len(prefix.encode("utf-8")) > 200:
        raise package.LibnovaError("Object prefix is too long")
    result["objectPrefix"] = prefix
    for key, default, minimum, maximum in (
            ("timeoutSeconds", 60, 1, 300), ("indexWaitSeconds", 60, 0, 600),
            ("jobWaitSeconds", 60, 0, 600), ("pollSeconds", 1, 0.1, 30)):
        amount = value.get(key, default)
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not minimum <= amount <= maximum:
            raise package.LibnovaError("Invalid bounded " + key)
        result[key] = amount
    s3 = value.get("s3")
    if not isinstance(s3, dict):
        raise package.LibnovaError("Enter the matching existing S3 storage configuration")
    if set(s3) - {"endpointUrl", "bucket", "region", "accessKeyEnv", "secretKeyEnv",
                  "sessionTokenEnv", "addressingStyle", "caFile"}:
        raise package.LibnovaError("Unknown S3 configuration properties")
    bucket = s3.get("bucket")
    if not isinstance(bucket, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]", bucket):
        raise package.LibnovaError("Enter an existing S3 bucket name")
    region = s3.get("region")
    if not isinstance(region, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,64}", region):
        raise package.LibnovaError("Enter the original storage region")
    result["s3"] = {
        "endpointUrl": origin(s3.get("endpointUrl"), loopback), "bucket": bucket, "region": region,
        "accessKeyEnv": env_name(s3.get("accessKeyEnv"), "S3 access key"),
        "secretKeyEnv": env_name(s3.get("secretKeyEnv"), "S3 secret"),
        "addressingStyle": s3.get("addressingStyle", "path"),
    }
    if result["s3"]["addressingStyle"] not in {"path", "virtual"}:
        raise package.LibnovaError("S3 addressingStyle must be path or virtual")
    if s3.get("sessionTokenEnv"):
        result["s3"]["sessionTokenEnv"] = env_name(s3["sessionTokenEnv"], "S3 session token")
    for owner, name, target in ((value, "caFile", result), (s3, "caFile", result["s3"])):
        if owner.get(name) is not None:
            if not isinstance(owner[name], str) or not owner[name]:
                raise package.LibnovaError("Enter a CA file path, not a TLS disable flag")
            target[name] = owner[name]
    if value.get("functionKey") is not None:
        result["functionKey"] = package.token(value["functionKey"], "Function key")
    result["allowLoopback"] = loopback
    note = value.get("note", "")
    if not isinstance(note, str) or len(note) > 10000:
        raise package.LibnovaError("Invalid configuration note")
    result["note"] = note
    return result


def redacted(value, name=""):
    if name.lower() in SECRET_FIELDS:
        return {"omitted": "credential-bearing provider field", "sha256": package.sha(package.canonical(value))}
    if name.lower() == "extra" and isinstance(value, str):
        try:
            return redacted(json.loads(value))
        except (ValueError, TypeError):
            return {"omitted": "unparsed storage extra", "sha256": package.sha(value.encode())}
    if isinstance(value, dict):
        return {key: redacted(item, key) for key, item in value.items()}
    if isinstance(value, list):
        return [redacted(item) for item in value]
    return value


def scrub_secrets(value, secrets):
    if isinstance(value, dict):
        return {key: scrub_secrets(item, secrets) for key, item in value.items()}
    if isinstance(value, list):
        return [scrub_secrets(item, secrets) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            value = value.replace(secret, "[configured secret omitted]")
    return value


def require_complete_collection(original, rows, label):
    if not isinstance(rows, list):
        raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Expected complete " + label)
    pending = [original]
    for _ in range(12):
        if not pending:
            return
        current = pending.pop()
        if not isinstance(current, dict):
            continue
        for key in ("has_more", "hasMore", "has_next", "hasNext", "next", "next_page",
                    "nextPage", "next_cursor", "nextCursor", "next_page_token", "nextPageToken"):
            if key in current and current[key] not in (None, False, 0, "", [], {}):
                raise ReceivingPause("PROVIDER_PAGINATION_REQUIRED",
                                     "The original " + label + " has an unconsumed continuation")
        for key in ("total", "total_count", "totalCount"):
            if key in current and current[key] is not None:
                total = current[key]
                if isinstance(total, bool):
                    raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Ambiguous collection total")
                try:
                    count = int(total)
                except (ValueError, TypeError) as exc:
                    raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Ambiguous collection total") from exc
                if count < 0 or str(count) != str(total) or count != len(rows):
                    raise ReceivingPause("PROVIDER_PAGINATION_REQUIRED",
                                         "The retained " + label + " does not match its declared complete count")
        for key in ("result", "data", "pagination", "meta"):
            if isinstance(current.get(key), dict):
                pending.append(current[key])
    raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Collection envelope nesting exceeded its limit")


def public_exception(exc):
    # The library exception text may contain a signed URL or access key.
    response = getattr(exc, "response", None)
    return {"type": type(exc).__name__,
            "code": response.get("Error", {}).get("Code") if isinstance(response, dict) else None,
            "httpStatus": response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if isinstance(response, dict) else None}


def unwrap(value):
    for _ in range(4):
        if not isinstance(value, dict):
            return value
        if value.get("success") is False:
            raise ReceivingPause("PROVIDER_REJECTED", "The original API returned success:false",
                                 provider=redacted(value))
        if "success" in value and "result" in value:
            value = value["result"]
        elif "success" in value and "data" in value:
            value = value["data"]
        elif "data" in value and set(value) <= {"data", "total", "limit", "offset", "pagination", "has_more"}:
            value = value["data"]
        else:
            return value
    return value


def one(value, label):
    value = unwrap(value)
    if isinstance(value, list):
        if len(value) != 1:
            raise ReceivingPause("PROVIDER_BINDING_MISMATCH", "Expected exactly one " + label)
        value = value[0]
    if not isinstance(value, dict):
        raise ReceivingPause("PROVIDER_BINDING_MISMATCH", "Missing original " + label)
    return value


def many(value, label):
    value = unwrap(value)
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Expected a list of " + label)
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        raise ReceivingPause("PROVIDER_REDIRECT", "The saved API origin redirected; review its configured origin")


class Api:
    def __init__(self, configuration, capture):
        self.configuration, self.capture = configuration, capture
        token = os.environ.get(configuration["tokenEnv"], "")
        if not token or "\r" in token or "\n" in token:
            raise package.LibnovaError("The configured API token environment variable is empty or invalid")
        self.token = token
        context = ssl.create_default_context(cafile=configuration.get("caFile"))
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))

    def call(self, method, path, body=None):
        path = package.safe(path)
        url = self.configuration["baseUrl"] + "/api/" + path
        data = package.canonical(body) if body is not None else None
        request = urllib.request.Request(url, data=data, method=method,
                                        headers={"Authorization": "Bearer " + self.token,
                                                 "Accept": "application/json",
                                                 "Content-Type": "application/json"})
        started = package.now()
        try:
            response = self.opener.open(request, timeout=self.configuration["timeoutSeconds"])
        except urllib.error.HTTPError as exc:
            response = exc
        except Exception as exc:
            self.capture({"kind": "api-transport-error", "method": method, "path": path,
                          "request": body, "startedAt": started, "error": public_exception(exc)})
            raise
        with response:
            raw = response.read(JSON_LIMIT + 1)
            status = response.status
            headers = {key: value for key, value in response.headers.items()
                       if key.lower() in {"content-type", "date", "retry-after",
                                          "x-request-id", "request-id", "etag"}}
        if len(raw) > JSON_LIMIT:
            self.capture({"kind": "api-response-limit", "method": method, "path": path,
                          "status": status, "bytesAtLimit": len(raw), "headers": headers})
            raise ReceivingPause("PROVIDER_RESPONSE_LIMIT", "API response exceeded the retained JSON limit")
        try:
            value = package.parse(raw)
        except Exception:
            value = {"nonJson": True}
        evidence = {"kind": "api-response", "startedAt": started, "observedAt": package.now(),
                    "method": method, "path": path, "request": body, "status": status,
                    "headers": headers, "responseBytes": len(raw), "responseSha256": package.sha(raw),
                    "body": redacted(value)}
        self.capture(evidence)
        if not 200 <= status < 300:
            raise ReceivingPause("PROVIDER_HTTP_ERROR", "Original API returned HTTP " + str(status),
                                 httpStatus=status, responseSha256=evidence["responseSha256"])
        if value == {"nonJson": True}:
            raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Expected the original API JSON response")
        result = unwrap(value)
        if method == "GET" and re.fullmatch(r"(job/[0-9]+/(messages|assets)|file/[0-9]+/metadata)", path):
            require_complete_collection(value, result, path.rsplit("/", 1)[-1])
        return result


class S3:
    """The maintained boto3 transport performs signing; no alternative signer."""
    def __init__(self, configuration, capture):
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:
            raise package.LibnovaError("Install the declared boto3 dependency for actual S3 receiving") from exc
        selected = configuration["s3"]
        access = os.environ.get(selected["accessKeyEnv"])
        secret = os.environ.get(selected["secretKeyEnv"])
        if not access or not secret:
            raise package.LibnovaError("The configured S3 credential environment references are empty")
        kwargs = {"aws_access_key_id": access, "aws_secret_access_key": secret}
        if selected.get("sessionTokenEnv"):
            token = os.environ.get(selected["sessionTokenEnv"])
            if not token:
                raise package.LibnovaError("The configured S3 session token reference is empty")
            kwargs["aws_session_token"] = token
        self.client = boto3.session.Session().client(
            "s3", endpoint_url=selected["endpointUrl"], region_name=selected["region"],
            verify=selected.get("caFile", True), **kwargs,
            config=Config(signature_version="s3v4", connect_timeout=configuration["timeoutSeconds"],
                          read_timeout=configuration["timeoutSeconds"],
                          retries={"total_max_attempts": 1},
                          s3={"addressing_style": selected["addressingStyle"]},
                          request_checksum_calculation="when_required",
                          response_checksum_validation="when_required"))
        if "IfNoneMatch" not in self.client.meta.service_model.operation_model("PutObject").input_shape.members:
            raise package.LibnovaError("This boto3 model lacks conditional PutObject; update the declared dependency")
        self.bucket, self.capture = selected["bucket"], capture

    def digest(self, key, *, retain=None, expected_size=None):
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            detail = public_exception(exc)
            self.capture({"kind": "s3-get-returned", "key": key, "error": detail})
            if detail["code"] in {"NoSuchKey", "NotFound", "404"} and detail["httpStatus"] == 404:
                return None
            raise
        body = response["Body"]
        h, length = hashlib.sha256(), 0
        collected = bytearray() if retain is not None else None
        try:
            while True:
                chunk = body.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
                length += len(chunk)
                if expected_size is not None and length > expected_size:
                    raise ReceivingPause("REMOTE_CONTENT_MISMATCH", "Remote object is larger than its frozen source", key=key)
                if collected is not None:
                    if len(collected) + len(chunk) > ASSET_LIMIT:
                        raise ReceivingPause("PROVIDER_ASSET_LIMIT", "Job report exceeds its receiving limit")
                    collected.extend(chunk)
        finally:
            body.close()
        result = {"key": key, "bytes": length, "sha256": h.hexdigest(),
                  "versionId": response.get("VersionId"), "etag": response.get("ETag")}
        self.capture({"kind": "s3-content-read", **result})
        if retain is not None:
            package.publish(retain, bytes(collected))
        return result

    def put(self, key, source, size, md5):
        response = self.client.put_object(
            Bucket=self.bucket, Key=key, Body=source, ContentLength=size,
            ContentMD5=base64.b64encode(md5).decode("ascii"), IfNoneMatch="*")
        result = {"key": key, "httpStatus": response.get("ResponseMetadata", {}).get("HTTPStatusCode"),
                  "requestId": response.get("ResponseMetadata", {}).get("RequestId"),
                  "versionId": response.get("VersionId"), "etag": response.get("ETag")}
        self.capture({"kind": "s3-put-returned", **result})
        return result

    def list(self, prefix):
        rows, seen = [], set()
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for row in page.get("Contents", []):
                key = row["Key"]
                if key in seen or not key.startswith(prefix):
                    raise ReceivingPause("REMOTE_INVENTORY_MISMATCH", "Repeated or out-of-prefix S3 object")
                seen.add(key)
                rows.append({"key": key, "bytes": row["Size"]})
                if len(rows) > MAX_OBJECTS:
                    raise ReceivingPause("REMOTE_INVENTORY_LIMIT", "The selected object prefix is too large")
        self.capture({"kind": "s3-list-complete", "prefix": prefix, "objects": rows})
        return rows

    def close(self):
        self.client.close()


def plan(workspace, configuration, operation_id):
    configuration = normalize_configuration(configuration)
    operation_id = package.token(operation_id, "operation ID")
    root = Path(workspace).absolute()
    with package.lock(root):
        verified = package.verify(root)
        prefix = configuration["objectPrefix"] + "/" + verified["id"] + "/" + package.sha(operation_id.encode())[:16]
        operation = {
            "schema": OP_SCHEMA, "id": operation_id, "packageId": verified["id"],
            "packageSha256": verified["packageSha256"], "configuration": configuration,
            "configurationSha256": package.sha(package.canonical(configuration)),
            "objectPrefix": prefix, "sdkCommit": SDK_COMMIT,
            "bagitFunctionCommit": BAGIT_FUNCTION_COMMIT,
        }
        directory = root / "operations" / operation_id
        if directory.exists() and (directory / "operation.json").exists():
            if package.read_json(directory, "operation.json") != operation:
                raise package.LibnovaError("Original operation already binds a different package or configuration")
        else:
            directory.mkdir(parents=True, exist_ok=True)
            package.publish_json(directory / "operation.json", operation)
        if not (directory / "state.json").exists():
            package.publish_json(directory / "state.json",
                                 {"schema": OP_SCHEMA + ".state", "state": "PLANNED",
                                  "operationId": operation_id, "updatedAt": package.now()})
        return {"operation": operation, "state": package.read_json(directory, "state.json"),
                "networkRequests": 0}


class Client:
    def __init__(self, workspace, operation_id, api_factory=None, s3_factory=None):
        self.root = Path(workspace).absolute()
        self.directory = self.root / "operations" / package.token(operation_id, "operation ID")
        self.operation = package.read_json(self.directory, "operation.json")
        self.verified = package.verify(self.root)
        cfg = normalize_configuration(self.operation.get("configuration"))
        if (self.operation.get("schema") != OP_SCHEMA or self.operation.get("id") != operation_id
                or self.operation.get("packageId") != self.verified["id"]
                or self.operation.get("packageSha256") != self.verified["packageSha256"]
                or self.operation.get("configurationSha256") != package.sha(package.canonical(cfg))):
            raise package.LibnovaError("Original operation source/configuration binding changed")
        expected_prefix = cfg["objectPrefix"] + "/" + self.verified["id"] + "/" + package.sha(operation_id.encode())[:16]
        if self.operation["objectPrefix"] != expected_prefix:
            raise package.LibnovaError("Original object namespace changed")
        self.configuration = cfg
        self.mapping = package.read_json(self.root, "mapping.json")
        self.records = package.read_json(self.root, "record-metadata.json")
        self.pkg = package.read_json(self.root, "package.json")
        secret_names = [cfg["tokenEnv"], cfg["s3"]["accessKeyEnv"], cfg["s3"]["secretKeyEnv"]]
        if cfg["s3"].get("sessionTokenEnv"):
            secret_names.append(cfg["s3"]["sessionTokenEnv"])
        self.secret_values = sorted({os.environ[name] for name in secret_names if os.environ.get(name)},
                                    key=len, reverse=True)
        self.api = (api_factory or Api)(cfg, self.capture)
        self.s3 = (s3_factory or S3)(cfg, self.capture)
        self.prefix = str(cfg["containerId"]) + "/" + self.operation["objectPrefix"] + "/"
        self.index = {}
        self.deadline = time.monotonic() + cfg["indexWaitSeconds"]
        self.previous = package.read_json(self.directory, "state.json")
        self.mutable = False

    def close(self):
        self.s3.close()

    def capture(self, value):
        raw = package.canonical(scrub_secrets(redacted(value), self.secret_values))
        directory = self.directory / "observations"
        directory.mkdir(exist_ok=True)
        # The original workspace flock serializes every writer and snapshot.
        counters = [int(path.name.split("-", 1)[0]) for path in directory.glob("*.json")
                    if re.fullmatch(r"[0-9]{8}-[0-9a-f]{64}\.json", path.name)]
        counter = max(counters, default=0) + 1
        name = f"{counter:08d}-{package.sha(raw)}.json"
        package.publish(directory / name, raw)
        return {"path": "observations/" + name, "bytes": len(raw), "sha256": package.sha(raw)}

    def state(self, status, **value):
        result = {"schema": OP_SCHEMA + ".state", "operationId": self.operation["id"],
                  "state": status, "updatedAt": package.now(), **value}
        if self.previous.get("state") == "VERIFIED" and status != "VERIFIED":
            result["previousVerifiedObservation"] = self.previous
        result = scrub_secrets(redacted(result), self.secret_values)
        self.capture({"kind": "operation-state", **result})
        package.replace_json(self.directory / "state.json", result)
        return result

    def action_path(self, key):
        return self.directory / "actions" / package.sha(key.encode())

    def action(self, key):
        path = self.action_path(key)
        if not (path / "request.json").exists():
            return None
        request = package.read_json(path, "request.json")
        if (request.get("schema") != OP_SCHEMA + ".action" or request.get("key") != key
                or request.get("operationId") != self.operation["id"]
                or request.get("packageId") != self.operation["packageId"]):
            raise package.LibnovaError("Original action identity changed")
        result = package.read_json(path, "result.json") if (path / "result.json").exists() else None
        if result is not None and (result.get("schema") != OP_SCHEMA + ".action-result"
                or result.get("operationId") != self.operation["id"]
                or result.get("requestSha256") != package.sha(package.canonical(request))):
            raise package.LibnovaError("Original action result binding changed")
        return {"request": request, "result": result, "path": path}

    def start(self, key, kind, arguments):
        request = {"schema": OP_SCHEMA + ".action", "operationId": self.operation["id"],
                   "packageId": self.operation["packageId"], "key": key, "kind": kind,
                   "arguments": arguments}
        old = self.action(key)
        if old:
            if old["request"] != request:
                raise package.LibnovaError("Original action request changed")
            return old, False
        if not self.mutable:
            raise ReceivingPause("REQUIRES_RUN", "Read-only refresh does not dispatch new writes", action=key)
        path = self.action_path(key)
        package.publish_json(path / "request.json", request)
        return {"request": request, "result": None, "path": path}, True

    def finish(self, action, outcome):
        value = {"schema": OP_SCHEMA + ".action-result", "operationId": self.operation["id"],
                 "requestSha256": package.sha(package.canonical(action["request"])),
                 "observedAt": package.now(), **outcome}
        path = action["path"] / "result.json"
        if path.exists():
            saved = package.read_json(action["path"], "result.json")
            if saved.get("requestSha256") != value["requestSha256"]:
                raise package.LibnovaError("Original action result binding changed")
            return saved
        package.publish_json(path, value)
        return value

    def returned_error(self, action, exc):
        self.capture({"kind": "action-returned-error", "action": action["request"]["key"],
                      "requestSha256": package.sha(package.canonical(action["request"])),
                      "error": public_exception(exc)})
        raise ReceivingPause("RECONCILE_REQUIRED",
                             "The original write returned an error; retain its action and read back before any new dispatch",
                             action=action["request"]["key"], error=public_exception(exc)) from exc

    def preflight(self):
        cfg = self.configuration
        container = one(self.api.call("GET", "container/" + str(cfg["containerId"])), "container")
        storage = one(self.api.call("GET", "storage/" + str(cfg["storageId"])), "storage")
        schema = one(self.api.call("GET", "objects/metadata/schema/" + str(cfg["metadataSchemaId"])), "schema")
        function = one(self.api.call("GET", "functions/" + str(cfg["functionId"])), "Function")
        for record, key, expected in (
                (container, "id", cfg["containerId"]),
                (container, "storage_id", cfg["storageId"]),
                (container, "metadata_schema_id", cfg["metadataSchemaId"]),
                (storage, "id", cfg["storageId"]), (schema, "id", cfg["metadataSchemaId"]),
                (function, "id", cfg["functionId"])):
            if positive(record.get(key), key) != expected:
                raise ReceivingPause("PROVIDER_BINDING_MISMATCH", "Existing container/storage/schema/Function IDs differ")
        if storage.get("type") not in {2, "2", "S3"}:
            raise ReceivingPause("UNSUPPORTED_STORAGE", "This original receiving profile requires the container's existing S3 storage")
        if function.get("source") not in {2, 3, "2", "3", "FOLDER", "ANY"}:
            raise ReceivingPause("UNSUPPORTED_FUNCTION", "Select an existing Function that accepts the exact bag folder")
        if cfg.get("functionKey") and function.get("key") != cfg["functionKey"]:
            raise ReceivingPause("PROVIDER_BINDING_MISMATCH", "The selected Function key changed")
        extra = storage.get("extra")
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except ValueError as exc:
                raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Storage extra is not valid JSON") from exc
        if not isinstance(extra, dict):
            raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Missing original S3 storage binding")
        if extra.get("bucket") != cfg["s3"]["bucket"]:
            raise ReceivingPause("PROVIDER_BINDING_MISMATCH", "Configured bucket differs from the container's actual storage")
        provider = str(extra.get("provider", "")).upper()
        entered_endpoint = cfg["s3"]["endpointUrl"]
        if provider in {"MINIO", "CEPH"}:
            endpoint = extra.get("endpoint")
            if not isinstance(endpoint, str) or not endpoint:
                raise ReceivingPause("PROVIDER_BINDING_MISMATCH", "Missing original S3-compatible endpoint")
            if "://" not in endpoint:
                secure = extra.get("secure", True)
                if not isinstance(secure, (bool, str, int)) or secure not in {True, False, "true", "false", 1, 0}:
                    raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Storage secure setting is ambiguous")
                endpoint = ("https://" if secure in {True, "true", 1} else "http://") + endpoint
            if origin(endpoint, cfg["allowLoopback"]) != entered_endpoint:
                raise ReceivingPause("PROVIDER_BINDING_MISMATCH", "Configured endpoint differs from the original storage")
        elif provider in {"AMAZON", "AWS", "S3"}:
            region = extra.get("region")
            if region != cfg["s3"]["region"]:
                raise ReceivingPause("PROVIDER_BINDING_MISMATCH", "Configured AWS region differs from the original storage")
            permitted = {"https://s3." + region + ".amazonaws.com"}
            if region == "us-east-1":
                permitted.add("https://s3.amazonaws.com")
            if extra.get("endpoint"):
                permitted.add(origin(extra["endpoint"], cfg["allowLoopback"]))
            if entered_endpoint not in permitted:
                raise ReceivingPause("PROVIDER_BINDING_MISMATCH", "Configured endpoint is not the selected AWS storage endpoint")
        else:
            raise ReceivingPause("UNSUPPORTED_STORAGE", "Enter a supported existing AMAZON, MINIO or CEPH storage")
        descriptors = []
        for row in self.mapping["fields"]:
            values = self.api.call("GET", "objects/metadata/schema/descriptor",
                                   {"conditions": [{"metadata_schema_id": cfg["metadataSchemaId"]},
                                                   {"iecode": row["iecode"]}]})
            descriptor = one(values, "mapped descriptor " + row["iecode"])
            if (descriptor.get("iecode") != row["iecode"]
                    or positive(descriptor.get("metadata_schema_id"), "descriptor schema") != cfg["metadataSchemaId"]
                    or descriptor.get("data_type") not in {row["dataType"], package.TYPES[row["dataType"]],
                                                          str(package.TYPES[row["dataType"]])}):
                raise ReceivingPause("DESCRIPTOR_MAPPING_MISMATCH", "Mapped descriptor code/type/schema differs",
                                     iecode=row["iecode"])
            descriptors.append({"id": positive(descriptor.get("id"), "descriptor ID"),
                                "iecode": row["iecode"], "dataType": row["dataType"]})
        binding = {
            "container": {"id": cfg["containerId"], "storageId": cfg["storageId"],
                          "metadataSchemaId": cfg["metadataSchemaId"]},
            "storage": {"id": cfg["storageId"], "provider": provider,
                        "endpointUrl": entered_endpoint, "bucket": cfg["s3"]["bucket"],
                        "region": cfg["s3"]["region"]},
            "function": {"id": cfg["functionId"], "key": function.get("key"),
                         "source": function.get("source")},
            "descriptors": descriptors,
        }
        original = self.directory / "provider-binding.json"
        if original.exists() and package.read_json(self.directory, original.name) != binding:
            raise ReceivingPause("PROVIDER_BINDING_CHANGED", "The saved original provider configuration changed")
        package.publish_json(original, binding)
        return binding

    def file_at(self, fullpath):
        values = many(self.api.call("GET", "file",
                                   {"conditions": [{"container_id": self.configuration["containerId"]},
                                                   {"fullpath": fullpath}, {"deleted": 0}],
                                    "limit": 2}), "indexed files")
        if not values:
            return None
        if len(values) != 1:
            raise ReceivingPause("REMOTE_INDEX_CONFLICT", "Multiple native files occupy the original path", path=fullpath)
        value = values[0]
        if (positive(value.get("container_id"), "file container") != self.configuration["containerId"]
                or value.get("fullpath") != fullpath or value.get("deleted", 0) not in {0, "0", False}):
            raise ReceivingPause("REMOTE_INDEX_CONFLICT", "Native file identity differs from its query")
        return value

    def object_rows(self):
        directories = {""}
        files = []
        for row in self.pkg["binding"]["bagMembers"]:
            path = package.safe(row["path"])
            parent = Path(path).parent.as_posix()
            while parent != ".":
                directories.add(parent)
                parent = Path(parent).parent.as_posix()
            files.append({"relative": path, "kind": "file", "bytes": row["bytes"], "sha256": row["sha256"]})
        empty_sha = hashlib.sha256(b"").hexdigest()
        rows = [{"relative": path, "kind": "directory", "bytes": 0, "sha256": empty_sha}
                for path in sorted(directories, key=lambda value: (value.count("/"), value))]
        rows.extend(sorted(files, key=lambda row: row["relative"]))
        for row in rows:
            suffix = row["relative"] + ("/" if row["kind"] == "directory" and row["relative"] else "")
            row["key"] = self.prefix + suffix
            row["fullpath"] = "/" + self.operation["objectPrefix"] + "/" + suffix
        return rows

    def namespace(self):
        path = self.directory / "namespace-admission.json"
        expected = {"schema": OP_SCHEMA + ".namespace", "prefix": self.prefix,
                    "containerId": self.configuration["containerId"],
                    "packageId": self.operation["packageId"], "operationId": self.operation["id"]}
        if path.exists():
            if package.read_json(self.directory, path.name) != expected:
                raise package.LibnovaError("Original namespace admission changed")
            return
        if self.s3.list(self.prefix) or self.file_at("/" + self.operation["objectPrefix"] + "/"):
            raise ReceivingPause("REMOTE_PREFIX_OCCUPIED",
                                 "Receive the original saved operation; a fresh plan cannot adopt an occupied namespace")
        if not self.mutable:
            raise ReceivingPause("REQUIRES_RUN", "The original operation has not admitted its empty destination namespace")
        package.publish_json(path, expected)

    def content_matches(self, observed, row):
        return observed is not None and observed["bytes"] == row["bytes"] and observed["sha256"] == row["sha256"]

    def upload_row(self, row):
        key = "put:" + row["key"]
        old = self.action(key)
        expected_arguments = {"bucket": self.configuration["s3"]["bucket"], **row, "ifNoneMatch": "*"}
        if old is not None and (old["request"]["kind"] != "conditional-s3-put"
                                or old["request"]["arguments"] != expected_arguments):
            raise package.LibnovaError("Original conditional PUT source/namespace binding changed")
        observed = self.s3.digest(row["key"], expected_size=row["bytes"])
        if old is not None:
            if self.content_matches(observed, row):
                if old["result"] is None:
                    self.finish(old, {"state": "CONTENT_OBSERVED", "content": observed,
                                      "basis": "Exact content read for the original already-started action"})
                return observed
            if observed is not None:
                raise ReceivingPause("REMOTE_CONTENT_MISMATCH", "Remote bytes differ from the original action", key=row["key"])
            if old["result"] is not None:
                raise ReceivingPause("REMOTE_CONTENT_MISSING", "A previously received object is now absent", key=row["key"])
            raise ReceivingPause("RECONCILE_REQUIRED",
                                 "Original PUT has no retained outcome and no observed object; it will not be dispatched again",
                                 action=key)
        if observed is not None:
            raise ReceivingPause("REMOTE_PREFIX_CONFLICT", "An unowned object appeared after namespace admission", key=row["key"])
        action, fresh = self.start(key, "conditional-s3-put",
                                   {"bucket": self.configuration["s3"]["bucket"], **row,
                                    "ifNoneMatch": "*"})
        if not fresh:
            raise package.LibnovaError("Unexpected concurrent original PUT action")
        if row["kind"] == "directory":
            handle = io.BytesIO(b"")
            expected_stat = None
        else:
            path = package.regular(self.root / "bag", row["relative"])
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            handle = os.fdopen(descriptor, "rb")
            expected_stat = os.fstat(descriptor)
        try:
            h, md5, size = hashlib.sha256(), hashlib.md5(), 0
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                h.update(block)
                md5.update(block)
                size += len(block)
            if size != row["bytes"] or h.hexdigest() != row["sha256"]:
                raise package.LibnovaError("Frozen input changed before original S3 dispatch")
            handle.seek(0)
            response = self.s3.put(row["key"], handle, size, md5.digest())
            if expected_stat is not None:
                current = os.fstat(handle.fileno())
                if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) != (
                        expected_stat.st_dev, expected_stat.st_ino, expected_stat.st_size, expected_stat.st_mtime_ns):
                    raise package.LibnovaError("Frozen input changed during S3 dispatch")
            self.capture({"kind": "original-put-returned", "action": key, "response": response})
        except Exception as exc:
            self.returned_error(action, exc)
        finally:
            handle.close()
        observed = self.s3.digest(row["key"], expected_size=row["bytes"])
        if not self.content_matches(observed, row):
            raise ReceivingPause("RECONCILE_REQUIRED", "Original PUT returned; exact content readback is not complete", action=key)
        self.finish(action, {"state": "CONTENT_OBSERVED", "content": observed,
                             "basis": "Original conditional PUT plus complete content readback"})
        return observed

    def wait_index(self, rows):
        result = []
        ids = set()
        for row in rows:
            value = self.file_at(row["fullpath"])
            while value is None and time.monotonic() < self.deadline:
                time.sleep(min(self.configuration["pollSeconds"], max(0, self.deadline - time.monotonic())))
                value = self.file_at(row["fullpath"])
            if value is None:
                raise ReceivingPause("WAITING_INDEX", "Original S3 bytes are received; native indexing is pending",
                                     path=row["fullpath"])
            file_id = positive(value.get("id"), "native File ID")
            expected_type = 2 if row["kind"] == "directory" else 1
            if value.get("type") not in {expected_type, str(expected_type),
                                          "FOLDER" if expected_type == 2 else "FILE"}:
                raise ReceivingPause("REMOTE_INDEX_MISMATCH", "Native file type differs", path=row["fullpath"])
            if row["kind"] == "file":
                try:
                    size = int(value["size"])
                except (KeyError, ValueError, TypeError) as exc:
                    raise ReceivingPause("REMOTE_INDEX_MISMATCH", "Native file size is missing") from exc
                if size != row["bytes"]:
                    raise ReceivingPause("REMOTE_INDEX_MISMATCH", "Native file size differs", path=row["fullpath"])
            if file_id in ids:
                raise ReceivingPause("REMOTE_INDEX_MISMATCH", "Two original paths share one native File ID")
            ids.add(file_id)
            result.append({"id": file_id, "containerId": self.configuration["containerId"],
                           "parent": value.get("parent"), "fullpath": row["fullpath"],
                           "relative": row["relative"], "kind": row["kind"],
                           "bytes": row["bytes"], "sha256": row["sha256"]})
        existing = self.directory / "indexed-files.json"
        if existing.exists() and package.read_json(self.directory, existing.name) != result:
            raise ReceivingPause("REMOTE_INDEX_CHANGED", "Original indexed File IDs/paths or parents changed")
        package.publish_json(existing, result)
        self.index = {row["relative"]: row for row in result}
        return result

    def children(self, parent_id):
        last_id, result, seen = 0, [], set()
        while True:
            values = many(self.api.call("GET", "file",
                                        {"conditions": [
                                            {"container_id": self.configuration["containerId"]},
                                            {"parent": parent_id}, {"deleted": 0},
                                            {"id": {"operator": "gt", "value": last_id}}],
                                         "limit": 1000}), "native folder children")
            if not values:
                return result
            page_ids = []
            for value in values:
                file_id = positive(value.get("id"), "native File ID")
                if file_id <= last_id or file_id in seen or value.get("parent") not in {parent_id, str(parent_id)}:
                    raise ReceivingPause("REMOTE_PAGINATION_MISMATCH", "Native keyset traversal failed to progress")
                if positive(value.get("container_id"), "native file container") != self.configuration["containerId"]:
                    raise ReceivingPause("REMOTE_INDEX_MISMATCH", "Native child belongs to another container")
                seen.add(file_id)
                page_ids.append(file_id)
                result.append(value)
                if len(result) > MAX_OBJECTS:
                    raise ReceivingPause("REMOTE_INDEX_LIMIT", "Native folder exceeds its receiving limit")
            last_id = max(page_ids)

    def verify_inventory(self, rows):
        observed = self.s3.list(self.prefix)
        expected = {row["key"]: row["bytes"] for row in rows}
        if {row["key"]: row["bytes"] for row in observed} != expected:
            raise ReceivingPause("REMOTE_INVENTORY_MISMATCH", "Actual S3 prefix differs from the complete bag and directory markers")
        native = {self.index[""]["id"]: self.index[""]["fullpath"]}
        queue = [self.index[""]["id"]]
        while queue:
            parent = queue.pop(0)
            for value in self.children(parent):
                file_id = positive(value["id"], "native File ID")
                path = value.get("fullpath")
                if file_id in native or not isinstance(path, str) or not path.startswith("/" + self.operation["objectPrefix"] + "/"):
                    raise ReceivingPause("REMOTE_INDEX_MISMATCH", "Repeated or escaped native folder entry")
                native[file_id] = path
                if value.get("type") in {2, "2", "FOLDER"}:
                    queue.append(file_id)
                elif value.get("type") not in {1, "1", "FILE"}:
                    raise ReceivingPause("REMOTE_INDEX_MISMATCH", "Unexpected indexed object type")
                if len(native) > MAX_OBJECTS:
                    raise ReceivingPause("REMOTE_INDEX_LIMIT", "Native tree exceeds the original profile")
        wanted = {row["id"]: row["fullpath"] for row in self.index.values()}
        if native != wanted:
            raise ReceivingPause("REMOTE_INDEX_MISMATCH", "Indexed folder closure differs from the complete original bag")
        return {"s3Objects": len(observed), "nativeFiles": len(native), "complete": True}

    def metadata(self, file_id):
        return many(self.api.call("GET", "file/" + str(file_id) + "/metadata"), "metadata values")

    def metadata_counts(self, values, *, codes=None):
        data_types = {row["iecode"]: row["dataType"] for row in self.mapping["fields"]}
        counter = Counter()
        for row in values:
            code, value = row.get("iecode"), row.get("value")
            if not isinstance(code, str):
                raise ReceivingPause("PROVIDER_SHAPE_CHANGED", "Metadata value has no descriptor code")
            if codes is not None and code not in codes:
                continue
            kind = data_types.get(code)
            if kind == "NUMBER":
                try:
                    parsed = Decimal(str(value))
                    if not parsed.is_finite():
                        raise ValueError
                    normal = str(parsed.normalize())
                except Exception as exc:
                    raise ReceivingPause("REMOTE_METADATA_MISMATCH", "Native NUMBER value cannot be compared") from exc
            elif kind == "BOOL":
                if value is True or value == "true":
                    normal = "true"
                elif value is False or value == "false":
                    normal = "false"
                else:
                    raise ReceivingPause("REMOTE_METADATA_MISMATCH", "Native BOOL value cannot be compared")
            elif kind in {"STRING", "LONGSTRING", "DATE"}:
                if not isinstance(value, str):
                    raise ReceivingPause("REMOTE_METADATA_MISMATCH", "Native text/date descriptor did not return a string")
                normal = value
            else:
                normal = package.canonical(value).decode("utf-8")
            counter[(code, normal)] += 1
        return counter

    def apply_metadata(self, record):
        indexed = self.index[record["path"]]
        file_id = indexed["id"]
        codes = {row["iecode"] for row in self.mapping["fields"]}
        wanted = self.metadata_counts(record["metadata"], codes=codes)
        current = self.metadata(file_id)
        observed = self.metadata_counts(current, codes=codes)
        baseline_name = "metadata-baselines/" + package.sha(record["identifier"].encode()) + ".json"
        baseline_path = self.directory / baseline_name
        if baseline_path.exists():
            baseline = package.read_json(self.directory, baseline_name)
            if (baseline["fileId"] != file_id or baseline["identifier"] != record["identifier"]
                    or baseline.get("expected") != record["metadata"]):
                raise package.LibnovaError("Original metadata baseline File ID or expected values changed")
        else:
            baseline = {"identifier": record["identifier"], "fileId": file_id,
                        "metadata": current, "expected": record["metadata"]}
            package.publish_json(baseline_path, baseline)
        original_unmapped = self.metadata_counts([row for row in baseline["metadata"] if row["iecode"] not in codes])
        actual_unmapped = self.metadata_counts([row for row in current if row["iecode"] not in codes])
        if any(actual_unmapped[key] < count for key, count in original_unmapped.items()):
            raise ReceivingPause("UNMAPPED_METADATA_CHANGED", "Original unmapped metadata was removed")
        key = "metadata:" + record["identifier"]
        old = self.action(key)
        expected_arguments = {"fileId": file_id,
                              "body": {"metadata": [{**row, "action": "ADD"} for row in record["metadata"]]}}
        if old is not None and (old["request"]["kind"] != "add-mapped-metadata"
                                or old["request"]["arguments"] != expected_arguments):
            raise package.LibnovaError("Original additive metadata action changed")
        if observed == wanted:
            if old is not None and old["result"] is None:
                self.finish(old, {"state": "METADATA_OBSERVED", "fileId": file_id,
                                  "metadata": record["metadata"], "unmappedPreserved": True})
            return {"fileId": file_id, "metadata": record["metadata"], "unmappedPreserved": True}
        if old is not None:
            raise ReceivingPause("RECONCILE_REQUIRED",
                                 "Original metadata ADD is not fully observed; no repeated ADD will be sent", action=key)
        if observed:
            raise ReceivingPause("REMOTE_METADATA_CONFLICT", "Mapped descriptors already contain different values",
                                 identifier=record["identifier"])
        arguments = {"fileId": file_id,
                     "body": {"metadata": [{**row, "action": "ADD"} for row in record["metadata"]]}}
        action, fresh = self.start(key, "add-mapped-metadata", arguments)
        if not fresh:
            raise package.LibnovaError("Unexpected concurrent metadata action")
        try:
            response = self.api.call("PUT", "file/" + str(file_id) + "/metadata", arguments["body"])
            self.capture({"kind": "metadata-add-returned", "fileId": file_id, "response": redacted(response)})
        except Exception as exc:
            self.returned_error(action, exc)
        current = self.metadata(file_id)
        actual_unmapped = self.metadata_counts([row for row in current if row["iecode"] not in codes])
        if self.metadata_counts(current, codes=codes) != wanted or any(
                actual_unmapped[key] < count for key, count in original_unmapped.items()):
            raise ReceivingPause("RECONCILE_REQUIRED", "Exact mapped and original unmapped values are not yet observed", action=key)
        proof = {"fileId": file_id, "metadata": record["metadata"], "unmappedPreserved": True}
        self.finish(action, {"state": "METADATA_OBSERVED", **proof})
        return proof

    def function_arguments(self):
        return {"containerId": self.configuration["containerId"],
                "fileId": self.index[""]["id"], "functionId": self.configuration["functionId"],
                "fullpath": self.index[""]["fullpath"],
                "body": {"extra": {"research_package_id": self.operation["packageId"],
                                    "research_operation_id": self.operation["id"]}}}

    def validate_call(self, value):
        value = one(value, "original Function response")
        expected = self.function_arguments()
        result = dict(value)
        for key, selected in (("container_id", expected["containerId"]), ("file_id", expected["fileId"])):
            if positive(result.get(key), key) != selected:
                raise ReceivingPause("ORIGINAL_JOB_BINDING_MISMATCH", "Original Function response selected a different container/folder")
        result["job_id"] = positive(result.get("job_id"), "original job ID")
        if result.get("file_path") not in (None, "", expected["fullpath"]):
            raise ReceivingPause("ORIGINAL_JOB_BINDING_MISMATCH", "Original Function response has a different file path")
        return result

    def validate_job(self, value, job_id, *, require_folder=False):
        value = one(value, "original job")
        for key, expected in (("id", job_id), ("container_id", self.configuration["containerId"]),
                              ("function_id", self.configuration["functionId"])):
            if positive(value.get(key), "job " + key) != expected:
                raise ReceivingPause("ORIGINAL_JOB_BINDING_MISMATCH", "Observed job differs from the original Function action")
        folder_id = self.index[""]["id"]
        bound = value.get("file_id") in {folder_id, str(folder_id)}
        if value.get("file_id") not in (None, 0, "0", folder_id, str(folder_id)):
            raise ReceivingPause("ORIGINAL_JOB_BINDING_MISMATCH", "Observed job belongs to another file")
        original_input = value.get("function_input")
        if isinstance(original_input, str):
            try:
                original_input = json.loads(original_input)
            except ValueError:
                original_input = None
        if isinstance(original_input, dict):
            data = original_input.get("function_data", original_input)
            selected = data.get("files") if isinstance(data, dict) else None
            if isinstance(selected, list) and selected:
                identifiers = [row.get("id") if isinstance(row, dict) else row for row in selected]
                if len(identifiers) == 1 and identifiers[0] in {folder_id, str(folder_id)}:
                    bound = True
                else:
                    raise ReceivingPause("ORIGINAL_JOB_BINDING_MISMATCH", "Observed job input selected another file set")
        if require_folder and not bound:
            raise ReceivingPause("ORIGINAL_JOB_BINDING_UNPROVEN",
                                 "An entered job ID needs its server-side original folder/input binding")
        return value

    def original_job(self):
        key = "function"
        old = self.action(key)
        arguments = self.function_arguments()
        if old is not None:
            if old["request"]["arguments"] != arguments:
                raise package.LibnovaError("Original Function action binding changed")
            if old["result"] is None:
                raise ReceivingPause("RECONCILE_REQUIRED",
                                     "Original Function was already started without a saved response; enter its original response or job ID",
                                     action=key)
            result = old["result"]
            if result.get("requestSha256") != package.sha(package.canonical(old["request"])):
                raise package.LibnovaError("Original Function result digest changed")
            call = self.validate_call(result["call"])
            return call
        action, fresh = self.start(key, "invoke-existing-bagit-function", arguments)
        if not fresh:
            raise package.LibnovaError("Unexpected concurrent Function action")
        path = (f"container/{arguments['containerId']}/file/{arguments['fileId']}"
                f"/event/{arguments['functionId']}")
        try:
            response = self.api.call("POST", path, arguments["body"])
            call = self.validate_call(response)
        except Exception as exc:
            self.returned_error(action, exc)
        self.finish(action, {"state": "ORIGINAL_JOB_RECORDED", "call": call})
        return call

    def job_outputs(self, job_id):
        messages = many(self.api.call("GET", "job/" + str(job_id) + "/messages", {}), "job messages")
        assets = many(self.api.call("GET", "job/" + str(job_id) + "/assets", {}), "job assets")
        if not assets:
            raise ReceivingPause("WAITING_JOB_ASSETS", "The original job has no receiving report asset yet", jobId=job_id)
        reports, seen = [], set()
        for asset in assets:
            if asset.get("job_id") is not None and positive(asset["job_id"], "asset job") != job_id:
                raise ReceivingPause("ORIGINAL_JOB_BINDING_MISMATCH", "Job asset is linked to another job")
            nested = asset.get("file")
            file_id = asset.get("file_id")
            if file_id is None and isinstance(nested, dict):
                file_id = nested.get("id")
            if file_id is None:
                file_id = asset.get("id")
            file_id = positive(file_id, "job asset file ID")
            if file_id in seen:
                raise ReceivingPause("PROVIDER_ASSET_MISMATCH", "Duplicate job asset ID")
            seen.add(file_id)
            file = one(self.api.call("GET", "file/" + str(file_id)), "job asset file")
            if positive(file.get("id"), "asset file") != file_id or positive(
                    file.get("container_id"), "asset container") != self.configuration["containerId"]:
                raise ReceivingPause("PROVIDER_ASSET_MISMATCH", "Job asset belongs to another container")
            fullpath = file.get("fullpath")
            if not isinstance(fullpath, str) or not fullpath.startswith("/") or fullpath.endswith("/"):
                raise ReceivingPause("PROVIDER_ASSET_MISMATCH", "Job asset is not an actual file path")
            relative = package.safe(fullpath[1:])
            size = file.get("size")
            if isinstance(size, bool):
                raise ReceivingPause("PROVIDER_ASSET_MISMATCH", "Job asset has an invalid size")
            try:
                size = int(size)
            except (ValueError, TypeError) as exc:
                raise ReceivingPause("PROVIDER_ASSET_MISMATCH", "Job asset has no byte size") from exc
            if not 0 <= size <= ASSET_LIMIT:
                raise ReceivingPause("PROVIDER_ASSET_LIMIT", "Original job asset exceeds the receiving limit")
            key = str(self.configuration["containerId"]) + "/" + relative
            # A report may be updated by the same running job. Each observed version
            # gets its own immutable local member; the original job ID is retained.
            observed = self.s3.digest(key, expected_size=size)
            if observed is None or observed["bytes"] != size:
                raise ReceivingPause("WAITING_JOB_ASSETS", "Original job report bytes are not yet available", fileId=file_id)
            member = f"job-assets/{job_id}-{file_id}-{observed['sha256']}.bin"
            retained = self.s3.digest(key, expected_size=size, retain=self.directory / member)
            if retained is None or retained["sha256"] != observed["sha256"]:
                raise ReceivingPause("PROVIDER_ASSET_CHANGED", "Job asset changed between observation and retained receiving")
            reports.append({"fileId": file_id, "fullpath": fullpath, "localPath": member,
                            "bytes": retained["bytes"], "sha256": retained["sha256"]})
        self.capture({"kind": "original-job-outputs", "jobId": job_id,
                      "messages": redacted(messages), "assets": reports})
        return {"messageCount": len(messages), "assets": reports}

    def wait_job(self, call):
        job_id = call["job_id"]
        deadline = time.monotonic() + self.configuration["jobWaitSeconds"]
        while True:
            job = self.validate_job(self.api.call("GET", "job/" + str(job_id)), job_id)
            status, result = job.get("status"), job.get("result")
            if status in {4, "4", "FAILED"} or result in {3, "3", "ERROR"}:
                # Preserve actual logs if returned; this read creates no new job.
                messages = self.api.call("GET", "job/" + str(job_id) + "/messages", {})
                self.capture({"kind": "original-job-failed", "jobId": job_id,
                              "job": redacted(job), "messages": redacted(messages)})
                raise ReceivingPause("ORIGINAL_JOB_FAILED", "The original selected Function job failed", jobId=job_id)
            if status in {2, "2", "COMPLETED"}:
                if result not in {1, "1", "OK", 2, "2", "OK_WITH_WARNING"}:
                    raise ReceivingPause("ORIGINAL_JOB_RESULT_UNKNOWN", "Completed job has no supported original result code", jobId=job_id)
                outputs = self.job_outputs(job_id)
                return {"id": job_id, "status": "COMPLETED",
                        "result": "OK_WITH_WARNING" if result in {2, "2", "OK_WITH_WARNING"} else "OK",
                        "binding": {"containerId": self.configuration["containerId"],
                                    "functionId": self.configuration["functionId"],
                                    "folderFileId": self.index[""]["id"]},
                        **outputs}
            if status not in {1, "1", "RUNNING", 3, "3", "WAITING"}:
                raise ReceivingPause("ORIGINAL_JOB_RESULT_UNKNOWN", "Original job status is not recognized", jobId=job_id)
            if time.monotonic() >= deadline:
                raise ReceivingPause("WAITING_JOB", "The original Function job is still running or waiting", jobId=job_id)
            time.sleep(min(self.configuration["pollSeconds"], max(0, deadline - time.monotonic())))

    def verify_records(self, rows):
        metadata_proofs = {}
        for record in self.records:
            proof = self.apply_metadata(record)
            metadata_proofs[record["path"]] = proof
        content_proofs = []
        for row in rows:
            observed = self.s3.digest(row["key"], expected_size=row["bytes"])
            if not self.content_matches(observed, row):
                raise ReceivingPause("REMOTE_CONTENT_MISMATCH", "Final original byte readback differs", key=row["key"])
            indexed = self.index[row["relative"]]
            value = one(self.api.call("GET", "file/" + str(indexed["id"])), "final native file")
            if (positive(value.get("id"), "final file ID") != indexed["id"]
                    or positive(value.get("container_id"), "final file container") != self.configuration["containerId"]
                    or value.get("fullpath") != indexed["fullpath"]
                    or value.get("type") not in ({1, "1", "FILE"} if row["kind"] == "file" else {2, "2", "FOLDER"})
                    or (row["kind"] == "file" and str(value.get("size")) != str(row["bytes"]))
                    or value.get("deleted", 0) not in {0, "0", False}):
                raise ReceivingPause("REMOTE_INDEX_CHANGED", "Final native file binding changed")
            content_proofs.append({"path": row["relative"], "kind": row["kind"],
                                   "fileId": indexed["id"], "fullpath": indexed["fullpath"],
                                   "bytes": observed["bytes"], "sha256": observed["sha256"],
                                   "versionId": observed.get("versionId")})
        by_path = {row["path"]: row for row in content_proofs}
        records = []
        for record in self.records:
            content = by_path[record["path"]]
            if content["sha256"] != record["sourceSha256"]:
                raise ReceivingPause("SOURCE_RECORD_MISMATCH", "Received record differs from its original native source")
            records.append({"identifier": record["identifier"], "path": record["path"],
                            "fileId": content["fileId"], "bytes": content["bytes"],
                            "sha256": content["sha256"], "sourceSha256": record["sourceSha256"],
                            "metadata": metadata_proofs[record["path"]]["metadata"],
                            "unmappedPreserved": True})
        inventory = self.verify_inventory(rows)
        return {"records": records, "members": content_proofs, "inventory": inventory}

    def execute(self, *, write):
        self.mutable = write
        self.state("PREFLIGHT")
        provider = self.preflight()
        self.namespace()
        rows = self.object_rows()
        self.state("UPLOADING" if write else "READING_ORIGINAL_OUTPUTS", objects=len(rows))
        for number, row in enumerate(rows, 1):
            self.upload_row(row)
            if number % 20 == 0:
                self.state("UPLOADING" if write else "READING_ORIGINAL_OUTPUTS",
                           observedObjects=number, objects=len(rows))
        self.state("WAITING_INDEX", receivedObjects=len(rows))
        self.wait_index(rows)
        self.verify_inventory(rows)
        self.state("MAPPING_METADATA", records=len(self.records))
        for record in self.records:
            self.apply_metadata(record)
        self.state("ORIGINAL_FUNCTION")
        call = self.original_job()
        self.state("WAITING_JOB", jobId=call["job_id"])
        job = self.wait_job(call)
        self.state("VERIFYING_ORIGINAL_RECORDS", jobId=job["id"])
        # Even run() becomes read-only after the original job is recorded.
        self.mutable = False
        proof = self.verify_records(rows)
        summary = {"sourceRecords": self.verified["summary"]["sourceRecords"],
                   "includedRecords": len(proof["records"]),
                   "excludedRecords": self.verified["summary"]["excludedRecords"],
                   "objects": len(rows), "originalJobId": job["id"],
                   "containerId": self.configuration["containerId"],
                   "metadataSchemaId": self.configuration["metadataSchemaId"],
                   "bytes": sum(row["bytes"] for row in rows),
                   "allOriginalBytesVerified": True, "allMappedMetadataVerified": True}
        evidence = {"schema": OP_SCHEMA + ".receiving", "operationId": self.operation["id"],
                    "packageId": self.operation["packageId"], "provider": provider,
                    "originalFunctionResponse": call, "job": job, "summary": summary,
                    "records": proof["records"], "members": proof["members"],
                    "inventory": proof["inventory"], "observedAt": package.now()}
        raw = package.canonical(evidence)
        member = "receiving/" + package.sha(raw) + ".json"
        package.publish(self.directory / member, raw)
        self.write_report(evidence, member)
        return self.state("VERIFIED", summary=summary, job=job,
                          proof={"path": member, "bytes": len(raw), "sha256": package.sha(raw)},
                          report="receiving/" + package.sha(raw) + ".html")

    def write_report(self, evidence, member):
        import html
        escape = lambda value: html.escape(str(value), quote=True)
        summary = evidence["summary"]
        rows = "".join("<tr><td>" + escape(row["identifier"]) + "</td><td>" +
                       escape(row["fileId"]) + "</td><td><code>" + escape(row["sha256"]) +
                       "</code></td><td>" + escape(len(row["metadata"])) + "</td></tr>"
                       for row in evidence["records"])
        text = (
            "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>LIBNOVA receiving</title>"
            "<style>body{font:16px system-ui;max-width:1150px;margin:36px auto;padding:0 20px}"
            "table{border-collapse:collapse;width:100%}th,td{padding:8px;text-align:left;"
            "border-bottom:1px solid #ccd3db;overflow-wrap:anywhere}code{font-size:12px}</style>"
            "<h1>LIBNOVA original research receiving</h1><p>Operation <code>" +
            escape(self.operation["id"]) + "</code>; existing container " +
            escape(summary["containerId"]) + ", original job " + escape(summary["originalJobId"]) +
            ".</p><p>" + escape(summary["includedRecords"]) + " included bibliographic records, " +
            escape(summary["excludedRecords"]) + " saved exclusions. Every original bag member "
            "was read back by SHA-256 and byte length, native File IDs and the full folder closure "
            "were reconciled, and every entered descriptor value was compared. The original "
            "unmapped metadata remains present.</p><p>The platform job is " +
            escape(evidence["job"]["result"]) + ". Job completion is recorded separately from "
            "the complete source/content/metadata proof. The selected Function's original reports "
            "remain in the portable operation history.</p><p>Source metadata is CC0; described "
            "articles and media retain their separate rights. This measured receiving observation "
            "does not promise future unchanged tenant state.</p>"
            "<table><thead><tr><th>Original identifier</th><th>Native File ID</th>"
            "<th>Actual content SHA-256</th><th>Mapped values</th></tr></thead><tbody>" +
            rows + "</tbody></table></html>")
        package.publish(self.directory / member.replace(".json", ".html"), text.encode("utf-8"))


def load_operation(workspace, operation_id):
    root = Path(workspace).absolute()
    operation_id = package.token(operation_id, "operation ID")
    verified = package.verify(root)
    operation = package.read_json(root / "operations" / operation_id, "operation.json")
    configuration = normalize_configuration(operation.get("configuration"))
    expected_prefix = (configuration["objectPrefix"] + "/" + verified["id"] + "/" +
                       package.sha(operation_id.encode())[:16])
    if (operation.get("schema") != OP_SCHEMA or operation.get("id") != operation_id
            or operation.get("packageId") != verified["id"]
            or operation.get("packageSha256") != verified["packageSha256"]
            or operation.get("configurationSha256") != package.sha(package.canonical(configuration))
            or operation.get("objectPrefix") != expected_prefix):
        raise package.LibnovaError("Original operation binding changed")
    return operation


def show(workspace, operation_id):
    operation = load_operation(workspace, operation_id)
    root = Path(workspace).absolute() / "operations" / operation_id
    state = package.read_json(root, "state.json")
    if state.get("schema") != OP_SCHEMA + ".state" or state.get("operationId") != operation_id:
        raise package.LibnovaError("Original operation progress identity changed")
    return {"operation": operation, "state": state, "networkRequests": 0,
            "mutation": False, "stateRead": "atomic saved progress; an active writer may advance it"}


def _execute(workspace, operation_id, *, write, api_factory=None, s3_factory=None):
    with package.lock(workspace):
        client = Client(workspace, operation_id, api_factory, s3_factory)
        try:
            try:
                return client.execute(write=write)
            except ReceivingPause as exc:
                return client.state(exc.status, message=str(exc), details=redacted(exc.details))
            except Exception as exc:
                client.state("OPERATION_ERROR", error=public_exception(exc),
                             action="Reopen the original saved operation and reconcile its retained actions")
                raise
        finally:
            client.close()


def run(workspace, operation_id, *, api_factory=None, s3_factory=None):
    return _execute(workspace, operation_id, write=True, api_factory=api_factory, s3_factory=s3_factory)


def refresh(workspace, operation_id, *, api_factory=None, s3_factory=None):
    return _execute(workspace, operation_id, write=False, api_factory=api_factory, s3_factory=s3_factory)


def reconciliation_template(kind="original-function-response"):
    if kind == "original-function-response":
        return {"schema": OP_SCHEMA + ".reconciliation", "kind": kind,
                "response": {"container_id": None, "file_id": None, "job_id": None,
                             "file_path": "", "event_key": ""},
                "note": "Paste the original returned Function JSON; do not create another job."}
    if kind == "original-job-id":
        return {"schema": OP_SCHEMA + ".reconciliation", "kind": kind, "jobId": None,
                "note": "Enter the original job ID and describe the retained source of that ID."}
    raise package.LibnovaError("Unsupported original Function reconciliation kind")


def reconcile(workspace, operation_id, evidence, *, api_factory=None, s3_factory=None):
    if not isinstance(evidence, dict) or evidence.get("schema") != OP_SCHEMA + ".reconciliation":
        raise package.LibnovaError("Unsupported original Function reconciliation")
    kind = evidence.get("kind")
    allowed = {"schema", "kind", "note"} | ({"response"} if kind == "original-function-response" else {"jobId"})
    if kind not in {"original-function-response", "original-job-id"} or set(evidence) - allowed:
        raise package.LibnovaError("Use the original Function response or an explicitly entered original job ID")
    if not isinstance(evidence.get("note"), str) or not evidence["note"].strip():
        raise package.LibnovaError("Describe the source of the original receiving evidence")
    with package.lock(workspace):
        client = Client(workspace, operation_id, api_factory, s3_factory)
        try:
            client.preflight()
            client.index = {row["relative"]: row for row in package.read_json(client.directory, "indexed-files.json")}
            action = client.action("function")
            if action is None:
                raise package.LibnovaError("No original started Function action exists to reconcile")
            if action["request"]["arguments"] != client.function_arguments():
                raise package.LibnovaError("Original Function request binding changed")
            if kind == "original-function-response":
                call = client.validate_call(evidence.get("response"))
                job_id = call["job_id"]
                job = client.validate_job(client.api.call("GET", "job/" + str(job_id)), job_id)
            else:
                job_id = positive(evidence.get("jobId"), "original job ID")
                job = client.validate_job(client.api.call("GET", "job/" + str(job_id)),
                                          job_id, require_folder=True)
                call = {"container_id": client.configuration["containerId"],
                        "file_id": client.index[""]["id"], "file_path": client.index[""]["fullpath"],
                        "job_id": job_id, "event_key": None,
                        "reconciliationBasis": "Entered original job ID with observed server folder binding"}
            if action["result"] is not None:
                if action["result"]["call"]["job_id"] != job_id:
                    raise package.LibnovaError("Original recorded job cannot be replaced")
            else:
                raw = package.canonical({"evidence": redacted(evidence), "job": redacted(job),
                                         "operationId": operation_id, "observedAt": package.now()})
                path = client.directory / "reconciliations" / (package.sha(raw) + ".json")
                package.publish(path, raw)
                client.finish(action, {"state": "ORIGINAL_JOB_RECONCILED", "call": call,
                                       "evidence": {"path": path.relative_to(client.directory).as_posix(),
                                                    "bytes": len(raw), "sha256": package.sha(raw)}})
            return client.state("ORIGINAL_JOB_RECONCILED", jobId=job_id,
                                action="Use refresh to read the same original job, reports and actual bytes")
        finally:
            client.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("configuration-template")
    template = commands.add_parser("reconciliation-template")
    template.add_argument("--kind", choices=("original-function-response", "original-job-id"),
                          default="original-function-response")
    make = commands.add_parser("plan")
    make.add_argument("--workspace", required=True)
    make.add_argument("--configuration", required=True)
    make.add_argument("--operation-id", required=True)
    for command in ("show", "run", "refresh", "reconcile"):
        sub = commands.add_parser(command)
        sub.add_argument("--workspace", required=True)
        sub.add_argument("--operation-id", required=True)
        if command == "reconcile":
            sub.add_argument("--evidence", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "configuration-template":
            result = configuration_template()
        elif args.command == "reconciliation-template":
            result = reconciliation_template(args.kind)
        elif args.command == "plan":
            result = plan(args.workspace, package.parse(Path(args.configuration).read_bytes()), args.operation_id)
        elif args.command == "reconcile":
            result = reconcile(args.workspace, args.operation_id, package.parse(Path(args.evidence).read_bytes()))
        else:
            result = globals()[args.command](args.workspace, args.operation_id)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        state = result.get("state")
        return 0 if not isinstance(state, str) or state in {"VERIFIED", "PLANNED", "ORIGINAL_JOB_RECONCILED"} else 2
    except Exception as exc:
        print(json.dumps({"state": "ERROR", "error": public_exception(exc),
                          "message": str(exc) if isinstance(exc, package.LibnovaError) else
                          "The original operation failed; inspect its retained sanitized observations"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

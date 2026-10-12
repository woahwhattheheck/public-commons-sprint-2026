"""Pinned SDK0.5 native jobs, My Files, and the customer's original S3 client."""
from __future__ import annotations

import contextlib
from datetime import datetime
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
import uuid

from .storage import OperationError, canonical, digest, hash_file, now, private_directory

SDK_VERSION = "0.5.0"
TERMINAL = {"COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"}


def plain(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if hasattr(value, "value"):
        return value.value
    return value


def native_dict(value):
    raw = getattr(value, "raw", None)
    return plain(raw if isinstance(raw, dict) and raw else value.to_dict())


def response_headers(headers):
    allowed = {"content-type", "content-length", "content-encoding", "etag", "last-modified",
               "x-amz-version-id", "x-amz-checksum-sha256", "x-amz-checksum-crc32",
               "x-amz-checksum-crc32c", "x-amz-checksum-type"}
    return {key.lower(): value for key, value in headers.items() if key.lower() in allowed}



def runtime_info():
    """Report the selected native runtime without returning connection secrets."""
    original_profile = os.environ.get("WHEROBOTS_OPERATOR_PROFILE")
    profile = json.loads(Path(original_profile).read_text()) if original_profile else {}
    if not isinstance(profile, dict):
        raise OperationError("RUNTIME_PROFILE", "Select an original private runtime profile object.")
    packages = {}
    for package in ("wherobots-python-sdk", "boto3", "requests", "pyarrow"):
        try:
            packages[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            packages[package] = None
    return {
        "sdk_version": packages["wherobots-python-sdk"],
        "required_sdk_version": SDK_VERSION,
        "packages": packages,
        "organization_id": profile.get("organization_id") or os.environ.get("WHEROBOTS_ORGANIZATION_ID"),
        "region": profile.get("region"),
        "runtimes": profile.get("runtimes", []),
        "api_base_url": profile.get("api_base_url") or os.environ.get("WHEROBOTS_API_BASE_URL") or "https://api.cloud.wherobots.com",
        "connection_configured": bool(os.environ.get("WHEROBOTS_API_KEY")),
    }


class NativeProvider:
    def __init__(self, profile=None, *, s3_factory=None):
        try:
            installed = importlib.metadata.version("wherobots-python-sdk")
        except importlib.metadata.PackageNotFoundError:
            raise OperationError("SDK_REQUIRED", "Install the included requirements with Python 3.10 or later.") from None
        if installed != SDK_VERSION:
            raise OperationError("SDK_VERSION", f"This operator uses the published SDK {SDK_VERSION}; installed version is {installed}.")
        if profile is None:
            path = os.environ.get("WHEROBOTS_OPERATOR_PROFILE")
            profile = json.loads(Path(path).read_text()) if path else {}
        if not isinstance(profile, dict):
            raise OperationError("RUNTIME_PROFILE", "Select an original private runtime profile object.")
        self.profile = profile
        self.s3_factory = s3_factory
        self.account = None
        self.config = None

    @staticmethod
    def error(error):
        if isinstance(error, OperationError):
            return error.as_dict()
        # Transport exception strings can contain signed URLs. Keep the native
        # classification and request identity without copying connection secrets.
        return {"code": type(error).__name__,
                "status": getattr(error, "status_code", None),
                "request_id": getattr(error, "request_id", None),
                "message": "The original provider operation returned " + type(error).__name__ + "."}

    def check_binding(self, account):
        from wherobots import WherobotsConfig
        configured_org = self.profile.get("organization_id") or os.environ.get("WHEROBOTS_ORGANIZATION_ID")
        if not configured_org:
            raise OperationError("RUNTIME_ORGANIZATION", "Set the existing organization ID in the private runtime profile or WHEROBOTS_ORGANIZATION_ID.")
        if account["organization_id"] != configured_org:
            raise OperationError("ACCOUNT_MISMATCH", "The reviewed organization differs from the selected private runtime profile.", status=409)
        base = self.profile.get("api_base_url") or os.environ.get("WHEROBOTS_API_BASE_URL") or "https://api.cloud.wherobots.com"
        if account["api_base_url"].rstrip("/") != base.rstrip("/"):
            raise OperationError("API_TARGET_MISMATCH", "The reviewed API target differs from the configured SDK target.", status=409)
        region = self.profile.get("region")
        if region and account["region"] != region:
            raise OperationError("REGION_MISMATCH", "The reviewed region differs from the selected runtime profile.", status=409)
        allowed = self.profile.get("runtimes")
        if allowed and account["runtime"] not in allowed:
            raise OperationError("RUNTIME_MISMATCH", "Select a runtime from the current private runtime profile.", status=409)
        self.account = dict(account)
        self.config = WherobotsConfig.from_env(region=account["region"], base_url=base,
            version=account["version"], client_chain="starforge-wherobots-operator/1.0.0")
        if not self.config.api_key:
            raise OperationError("SDK_CONNECTION", "Use the existing private WHEROBOTS_API_KEY connection in this runtime.")

    def _require_config(self):
        if self.config is None:
            raise OperationError("REVIEWED_ACCOUNT", "Bind the original reviewed account before a native provider operation.")

    def payload(self, operation, script_uri):
        from wherobots.models import CreateRunPayload, RunEnvironment, RunPythonPayload, RunJarPayload
        definition = operation["reviewed_definition"]
        job, account = definition["job"], definition["account"]
        jar = job["script"]["filename"].lower().endswith(".jar")
        env = RunEnvironment(spark_configs=job.get("spark_configs") or None,
            dependencies=job.get("dependencies") or None,
            spark_driver_disk_gb=job.get("spark_driver_disk_gb"),
            spark_executor_disk_gb=job.get("spark_executor_disk_gb"))
        value = CreateRunPayload(name=operation["native_name"], runtime=account["runtime"],
            version=account["version"], timeout_seconds=job["timeout_seconds"],
            run_python=None if jar else RunPythonPayload(uri=script_uri, args=job["args"]),
            run_jar=RunJarPayload(uri=script_uri, args=job["args"], main_class=job["jar_main_class"]) if jar else None,
            environment=env)
        return value.to_dict()

    def upload_script(self, workspace, operation):
        from wherobots import FilesAPI
        self._require_config()
        script = operation["reviewed_definition"]["job"]["script"]
        source = workspace.object_path(script["object"]["sha256"])
        if hash_file(source) != (script["object"]["sha256"], script["object"]["bytes"]):
            raise OperationError("SCRIPT_CHANGED", "The retained original script no longer matches its review.", status=409)
        subdir = "starforge/" + operation["workflow_id"] + "/" + script["object"]["sha256"]
        with FilesAPI.from_config(self.config) as files:
            return files.upload_managed_file(str(source), subdir, dest_filename=script["filename"])

    def submit(self, operation):
        from wherobots import WherobotsJob
        self._require_config()
        definition = operation["reviewed_definition"]
        job, account = definition["job"], definition["account"]
        with WherobotsJob(script=operation["script_uri"], name=operation["native_name"],
                config=self.config, runtime=account["runtime"], region=account["region"],
                version=account["version"], timeout_seconds=job["timeout_seconds"],
                args=job["args"], spark_configs=job.get("spark_configs"),
                dependencies=job.get("dependencies"), jar_main_class=job.get("jar_main_class"),
                spark_driver_disk_gb=job.get("spark_driver_disk_gb"),
                spark_executor_disk_gb=job.get("spark_executor_disk_gb"), auto_upload=False) as native:
            return native.submit()

    @staticmethod
    def _organization_ids(view):
        result = set()
        if view.get("organizationId"):
            result.add(view["organizationId"])
        owner = view.get("triggeredBy") or {}
        if owner.get("organizationId"):
            result.add(owner["organizationId"])
        for role in owner.get("roles") or []:
            if role.get("organizationId"):
                result.add(role["organizationId"])
        return result

    def matches(self, operation, view):
        if not isinstance(view, dict) or not view.get("id"):
            return False
        known = operation.get("native_run_id")
        if known and view["id"] != known:
            return False
        definition = operation["reviewed_definition"]
        organizations = self._organization_ids(view)
        if organizations and definition["account"]["organization_id"] not in organizations:
            return False
        region = view.get("region") or (view.get("kubeApp") or {}).get("regionName")
        if region and region != definition["account"]["region"]:
            return False
        expected = operation.get("native_payload")
        if not expected:
            return False
        if known:
            # The exact run ID was returned by the original submission or
            # reconciled against its source before it became authoritative.
            # Retain native normalization in the full response; runtime
            # defaults and timeout clamping do not change that run identity.
            return True
        payload = view.get("payload") or view
        # Preserve the full raw response. Compare the actual original request,
        # including nested Python/JAR fields, rather than a newest-name match.
        keys = ("name", "runtime", "version", "timeoutSeconds", "runPython", "runJar", "environment")
        actual = {key: payload[key] for key in keys if key in payload}
        if "name" not in actual and view.get("name"):
            actual["name"] = view["name"]
        for key in ("runPython", "runJar", "environment"):
            if actual.get(key) in (None, {}):
                actual.pop(key, None)
        wanted = {key: value for key, value in expected.items() if value is not None and value != {}}
        # Server-side timeout clamping and resolving "latest" are native
        # defaults. The complete returned payload is retained beside review.
        actual.pop("timeoutSeconds", None); wanted.pop("timeoutSeconds", None)
        if wanted.get("version") == "latest":
            actual.pop("version", None); wanted.pop("version", None)
        return canonical(actual) == canonical(wanted)

    def find_run(self, workspace, operation, native_run_id=None):
        from wherobots import WherobotsJob
        self._require_config()
        if native_run_id:
            with WherobotsJob.from_run_id(native_run_id, config=self.config) as native:
                raw = native_dict(native.get_status())
            ref = workspace.put_object(canonical(raw))
            return [raw], [ref]
        cursor, seen, views, objects = None, set(), [], []
        while True:
            page = WherobotsJob.list_runs(config=self.config, region=self.account["region"],
                name_pattern=operation["native_name"], cursor=cursor, size=100)
            raw = native_dict(page)
            objects.append(workspace.put_object(canonical(raw)))
            for view in page.items:
                if view.name == operation["native_name"]:
                    views.append(native_dict(view))
            following = page.next_page
            if following is None:
                break
            if following == cursor or following in seen:
                raise OperationError("RUN_PAGE_CYCLE", "The original run listing repeated its continuation cursor.",
                                     details={"source_objects": objects})
            seen.add(following); cursor = following
        return views, objects

    def snapshot(self, workspace, operation, include_logs=False):
        from wherobots import WherobotsJob
        self._require_config()
        result = {}
        with WherobotsJob.from_run_id(operation["native_run_id"], config=self.config) as native:
            view = native_dict(native.get_status())
            result.update(run=view, run_object=workspace.put_object(canonical(view)))
            for name, call in (("metrics", native.get_metrics), ("cost", native.get_cost)):
                try:
                    value = call()
                    value = native_dict(value) if hasattr(value, "to_dict") else value
                    result[name] = {"state": "CAPTURED", "captured_at": now(),
                                    "object": workspace.put_object(canonical(value)),
                                    **({"usd": value} if name == "cost" else {})}
                except Exception as error:
                    result[name] = {"state": "UNAVAILABLE", "error": self.error(error), "captured_at": now()}
            if include_logs:
                cursor, seen, pages, count = 0, set(), [], 0
                while True:
                    page = native.get_logs(cursor=cursor, size=100)
                    raw = native_dict(page)
                    pages.append(workspace.put_object(canonical(raw)))
                    count += len(page.items)
                    following = page.next_page
                    if following is None:
                        break
                    if following == cursor or str(following) in seen:
                        raise OperationError("LOG_PAGE_CYCLE", "The native log stream repeated its continuation cursor.",
                                             details={"retained_pages": pages})
                    seen.add(str(following)); cursor = following
                result["logs"] = {"captured_at": now(), "complete": True, "pages": pages, "entries": count}
        return result

    def cancel(self, operation):
        from wherobots import WherobotsJob
        self._require_config()
        with WherobotsJob.from_run_id(operation["native_run_id"], config=self.config) as native:
            return {"native_run_id": operation["native_run_id"], "requested": native.cancel()}

    def _s3(self, definition):
        if self.s3_factory:
            return self.s3_factory(definition, self.account)
        import boto3
        # The customer's original AWS credential chain / SSO profile remains
        # outside every workflow, object, portable archive and browser response.
        region = definition.get("s3_region") or self.profile.get("s3_region")
        if not region and self.account["region"].startswith("aws-"):
            region = self.account["region"][4:]
        session = boto3.Session(profile_name=self.profile.get("aws_profile") or os.environ.get("WHEROBOTS_AWS_PROFILE"))
        return session.client("s3", region_name=region)

    @staticmethod
    def _s3_options(definition):
        return {**({"RequestPayer": "requester"} if definition.get("requester_pays") else {}),
                **({"ExpectedBucketOwner": definition["expected_bucket_owner"]} if definition.get("expected_bucket_owner") else {})}

    def _list_s3(self, workspace, definition, maximum):
        source = urlsplit(definition["path"])
        bucket, prefix = source.netloc, source.path.lstrip("/")
        options = self._s3_options(definition)
        client = self._s3(definition)
        cursor, seen, entries, pages = None, set(), [], []
        try:
            while True:
                arguments = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000, **options}
                if cursor:
                    arguments["ContinuationToken"] = cursor
                raw = client.list_objects_v2(**arguments)
                pages.append(workspace.put_object(canonical(plain(raw))))
                for row in raw.get("Contents", []):
                    key = row["Key"]
                    if not key.startswith(prefix):
                        raise OperationError("S3_SCOPE", "The provider returned an object outside the selected output prefix.")
                    if key.endswith("/") and row.get("Size") == 0:
                        continue
                    if len(entries) >= maximum:
                        raise OperationError("OUTPUT_OBJECT_LIMIT", "The original output exceeds its reviewed object limit.",
                                             details={"retained_listing_pages": pages})
                    head = client.head_object(Bucket=bucket, Key=key, IfMatch=row["ETag"], **options)
                    metadata = plain({k: v for k, v in head.items() if k != "ResponseMetadata"})
                    relative = key[len(prefix):].lstrip("/") or PurePosixPath(key).name
                    entries.append({"path": key, "relative_path": relative, "bytes": head["ContentLength"],
                        "etag": head.get("ETag"), "version_id": head.get("VersionId"),
                        "provider": {"store": "s3", "uri": "s3://" + bucket + "/" + key,
                                     "listing": plain(row), "head": metadata}})
                if not raw.get("IsTruncated"):
                    break
                following = raw.get("NextContinuationToken")
                if not following or following == cursor or following in seen:
                    raise OperationError("S3_PAGE_CYCLE", "The original S3 listing has no advancing continuation cursor.")
                seen.add(following); cursor = following
        finally:
            client.close()
        return entries, pages

    def _list_my_files(self, workspace, definition, maximum):
        from wherobots import Drive, FilesDrive
        from wherobots.api.base import BaseClient
        from wherobots.models import DirectoryPage
        entries, pages, queue, directories = [], [], [definition["path"].rstrip("/")], set()
        root = queue[0]
        with BaseClient(self.config) as client:
            drive = FilesDrive(client, Drive.MY_FILES, self.account["region"])
            while queue:
                folder = queue.pop(0)
                if folder in directories:
                    raise OperationError("DIRECTORY_CYCLE", "The native output listing repeated a directory.")
                directories.add(folder)
                cursor, seen = None, set()
                while True:
                    params = {"limit": 100}
                    if cursor is not None:
                        params["cursor"] = cursor
                    # SDK0.5's convenience list_directory hides repeated-cursor
                    # termination. Its same authenticated native route is paged
                    # here so only actual exhaustion makes a complete edition.
                    response = client.get(drive._route("directories", folder.split("/")), params=params)
                    raw = response.json()
                    pages.append(workspace.put_object(canonical(raw)))
                    page = DirectoryPage.from_dict(raw)
                    raw_items = [x for x in (raw.get("items") or []) if isinstance(x, dict)]
                    for index, entry in enumerate(page.entries):
                        if not entry.name or PurePosixPath(entry.name).name != entry.name or "\\" in entry.name or entry.name in (".", ".."):
                            raise OperationError("FILE_NAME", "The native listing returned an invalid direct child name.")
                        path = folder + "/" + entry.name
                        if entry.is_dir:
                            queue.append(path)
                            if len(queue) + len(directories) > maximum * 100:
                                raise OperationError("DIRECTORY_LIMIT", "The selected output has too many directories for its reviewed file limit.")
                        else:
                            if len(entries) >= maximum:
                                raise OperationError("OUTPUT_OBJECT_LIMIT", "The original output exceeds its reviewed object limit.",
                                                     details={"retained_listing_pages": pages})
                            original = raw_items[index] if index < len(raw_items) else {
                                "name": entry.name, "path": entry.path, "size": entry.size,
                                "lastModified": plain(entry.last_modified)}
                            entries.append({"path": path, "relative_path": path[len(root) + 1:],
                                "bytes": entry.size, "etag": original.get("etag") or original.get("ETag"),
                                "last_modified": plain(entry.last_modified),
                                "provider": {"store": "my_files", "uri": path, "listing": original,
                                             "drive": "MY_FILES", "region": self.account["region"],
                                             "storage_id": drive.storage_id}})
                    following = page.next_cursor
                    if following is None:
                        break
                    if following == cursor or following in seen:
                        raise OperationError("FILES_PAGE_CYCLE", "The original Files listing repeated its continuation cursor.",
                                             details={"retained_listing_pages": pages})
                    seen.add(following); cursor = following
        return entries, pages

    def _download_s3(self, definition, entry, destination, maximum):
        source = urlsplit(entry["provider"]["uri"])
        client = self._s3(definition)
        body = None
        try:
            options = self._s3_options(definition)
            args = {"Bucket": source.netloc, "Key": entry["path"], **options}
            if entry.get("version_id"):
                args["VersionId"] = entry["version_id"]
            if entry.get("etag"):
                args["IfMatch"] = entry["etag"]
            response = client.get_object(**args)
            body = response["Body"]
            if response.get("ContentLength") != entry["bytes"] or response.get("ContentLength", 0) > maximum:
                raise OperationError("OUTPUT_CHANGED", "The native output size changed after its retained listing.", status=409)
            if entry.get("version_id") and response.get("VersionId") != entry["version_id"]:
                raise OperationError("OUTPUT_VERSION", "The downloaded S3 object has another native version.", status=409)
            size = 0
            with destination.open("xb") as out:
                for chunk in body.iter_chunks(chunk_size=1024 * 1024):
                    size += len(chunk)
                    if size > maximum or size > entry["bytes"]:
                        raise OperationError("OUTPUT_SIZE", "The original output exceeds its reviewed byte limit.")
                    out.write(chunk)
                out.flush(); os.fsync(out.fileno())
            if size != entry["bytes"]:
                raise OperationError("OUTPUT_INCOMPLETE", "The native output stream ended before its declared byte length.")
            return plain({k: v for k, v in response.items() if k not in {"Body", "ResponseMetadata"}})
        finally:
            if body is not None:
                body.close()
            client.close()

    def _download_my_files(self, entry, destination, maximum):
        from wherobots import Drive, FilesDrive
        from wherobots.api.base import BaseClient
        import requests
        captured = {}
        class RetainedDrive(FilesDrive):
            def _fetch(self, url, path, target):
                # Extend the SDK's original download hook: native path/redirect
                # selection and API authentication still belong to FilesDrive.
                # Preserve storage metadata while enforcing the reviewed cap.
                headers = {"If-Match": entry["etag"]} if entry.get("etag") else {}
                if not headers and entry.get("last_modified"):
                    from email.utils import format_datetime
                    stamp = datetime.fromisoformat(entry["last_modified"].replace("Z", "+00:00"))
                    headers["If-Unmodified-Since"] = format_datetime(stamp, usegmt=True)
                with requests.get(url, headers=headers, stream=True, timeout=self._timeout,
                                  allow_redirects=False) as response:
                    self._check_download(response, path)
                    captured.update(response_headers(response.headers))
                    length = response.headers.get("Content-Length")
                    if length is not None and int(length) != entry["bytes"]:
                        raise OperationError("OUTPUT_CHANGED", "The native output changed after its retained listing.", status=409)
                    size = 0
                    with Path(target).open("xb") as out:
                        for chunk in response.raw.stream(amt=1024 * 1024, decode_content=False):
                            size += len(chunk)
                            if size > maximum or size > entry["bytes"]:
                                raise OperationError("OUTPUT_SIZE", "The original output exceeds its reviewed byte limit.")
                            out.write(chunk)
                        out.flush(); os.fsync(out.fileno())
                    if size != entry["bytes"]:
                        raise OperationError("OUTPUT_INCOMPLETE", "The native output ended before its declared byte length.")
        with BaseClient(self.config) as client:
            drive = RetainedDrive(client, Drive.MY_FILES, self.account["region"])
            drive.download_file(entry["path"], destination)
        return captured

    def capture_outputs(self, workspace, operation):
        self._require_config()
        definitions = operation["reviewed_definition"]["outputs"]
        limits = operation["reviewed_definition"]["limits"]
        capture_id = "capture-" + digest([operation["id"], definitions, operation["native_run_id"]])[:32]
        try:
            capture = workspace.get_record("capture", capture_id)
        except OperationError as error:
            if error.status != 404:
                raise
            datasets, total_objects, total_bytes = [], 0, 0
            for definition in definitions:
                remaining = min(limits["max_objects"] - total_objects, definition.get("max_objects", limits["max_objects"]))
                method = self._list_s3 if definition["store"] == "s3" else self._list_my_files
                entries, pages = method(workspace, definition, remaining)
                if len({x["relative_path"] for x in entries}) != len(entries):
                    raise OperationError("OUTPUT_PATH_REPEATED", "The native inventory repeats an output path; refresh its original listing.")
                dataset_bytes = sum(entry["bytes"] for entry in entries)
                if dataset_bytes > definition.get("max_bytes", limits["max_bytes"]):
                    raise OperationError("DATASET_BYTE_LIMIT", "The original dataset exceeds its reviewed byte limit.")
                total_objects += len(entries)
                total_bytes += dataset_bytes
                if total_bytes > limits["max_bytes"]:
                    raise OperationError("OUTPUT_BYTE_LIMIT", "The original output exceeds the reviewed receiving byte limit.",
                                         details={"objects": total_objects, "bytes": total_bytes})
                listing = workspace.put_object(canonical({"schema": "starforge.wherobots.output-listing.v1", "definition": definition, "entries": entries,
                    "pages": pages, "complete": True, "captured_at": now()}))
                datasets.append({"dataset_id": definition["id"], "definition": definition,
                                 "entries": entries, "listing_object": listing, "source_objects": pages, "files": [], "complete": False})
            capture = workspace.save_record("capture", capture_id, {"id": capture_id,
                "workflow_id": operation["workflow_id"], "operation_id": operation["id"],
                "native_run_id": operation["native_run_id"], "datasets": datasets,
                "created_at": now(), "total_objects": total_objects, "total_bytes": total_bytes,
                "state": "DOWNLOADING"})
        temporary = private_directory(workspace.directory / "downloads", create=True)
        for dataset_index, dataset in enumerate(capture["datasets"]):
            existing = {part["relative_path"]: part for part in dataset["files"]}
            for entry in dataset["entries"]:
                if entry["relative_path"] in existing:
                    ref = existing[entry["relative_path"]]["object"]
                    if hash_file(workspace.object_path(ref["sha256"])) != (ref["sha256"], ref["bytes"]):
                        raise OperationError("OUTPUT_OBJECT_CHANGED", "A retained completed part changed on disk.", status=409)
                    continue
                destination = temporary / uuid.uuid4().hex
                method = self._download_s3 if dataset["definition"]["store"] == "s3" else self._download_my_files
                try:
                    if dataset["definition"]["store"] == "s3":
                        headers = method(dataset["definition"], entry, destination, limits["max_bytes"])
                    else:
                        headers = method(entry, destination, limits["max_bytes"])
                    obj = workspace.put_object(destination)
                finally:
                    with contextlib.suppress(FileNotFoundError):
                        destination.unlink()
                part = {"relative_path": entry["relative_path"], "object": obj,
                        "provider": {**entry["provider"], "response": headers}}
                capture["datasets"][dataset_index]["files"].append(part)
                capture = workspace.save_record("capture", capture_id, capture, capture["revision_sha256"])
                workspace.event("operation", operation["id"], {"kind": "OUTPUT_PART_CAPTURED",
                    "dataset_id": dataset["dataset_id"], "relative_path": entry["relative_path"], "object": obj})
            capture["datasets"][dataset_index]["complete"] = True
            capture = workspace.save_record("capture", capture_id, capture, capture["revision_sha256"])
        capture = workspace.save_record("capture", capture_id, {**capture, "state": "COMPLETE", "completed_at": now()},
                                        capture["revision_sha256"])
        return [{key: value for key, value in dataset.items() if key != "entries"} for dataset in capture["datasets"]]

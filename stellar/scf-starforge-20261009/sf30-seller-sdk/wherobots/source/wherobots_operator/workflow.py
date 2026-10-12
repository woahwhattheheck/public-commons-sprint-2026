"""The reviewed customer workflow and its original native run lifecycle."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit
import copy
import hashlib
import re

from .storage import Workspace, OperationError, canonical, digest, identifier, now

WORKFLOW_SCHEMA = "starforge.wherobots.workflow.v1"
FORMATS = {"csv", "ndjson", "json", "geojson-seq", "parquet", "geoparquet"}
JOB_FIELDS = {"name", "script", "args", "timeout_seconds", "spark_configs", "dependencies",
              "spark_driver_disk_gb", "spark_executor_disk_gb", "jar_main_class"}


def _text(value, name, *, maximum=4096):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise OperationError("INVALID_INPUT", f"Supply a nonempty {name} of at most {maximum} characters.")
    return value


def _uri(value, name, schemes=("s3", "https")):
    value = _text(value, name)
    parsed = urlsplit(value)
    if parsed.scheme not in schemes or not parsed.netloc or parsed.username or parsed.password:
        raise OperationError("INVALID_URI", f"Use an ordinary {' or '.join(schemes)} URI for {name}.")
    if parsed.query or parsed.fragment:
        raise OperationError("URI_QUERY", f"Use a stable source URI for {name}; retain provider versions in their separate field.")
    return value


def import_script(workspace, filename, content):
    filename = _text(filename, "script filename", maximum=255)
    if Path(filename).name != filename or "/" in filename or "\\" in filename or not filename.lower().endswith((".py", ".jar")):
        raise OperationError("SCRIPT_FILENAME", "Select the original Python script or JAR filename.")
    if isinstance(content, Path):
        if content.stat().st_size > 64 * 1024 * 1024:
            raise OperationError("SCRIPT_SIZE", "Use a script or JAR within 64 MiB.")
    elif len(content) > 64 * 1024 * 1024:
        raise OperationError("SCRIPT_SIZE", "Use a script or JAR within 64 MiB.")
    obj = workspace.put_object(content)
    return {"filename": filename, **obj, "object": obj}


def validate_definition(workspace, definition):
    if not isinstance(definition, dict):
        raise OperationError("WORKFLOW_OBJECT", "Supply the original workflow definition as a JSON object.")
    value = copy.deepcopy(definition)
    value.pop("revision_sha256", None)
    if value.get("schema") != WORKFLOW_SCHEMA:
        raise OperationError("WORKFLOW_SCHEMA", f"Use schema {WORKFLOW_SCHEMA}.")
    identifier(value.get("id"), "workflow ID")
    _text(value.get("title"), "workflow title", maximum=200)
    account = value.get("account")
    if not isinstance(account, dict):
        raise OperationError("ACCOUNT_REQUIRED", "Select the existing Wherobots organization, region and runtime.")
    for key in ("organization_id", "region", "runtime"):
        _text(account.get(key), key, maximum=200)
    account.setdefault("api_base_url", "https://api.cloud.wherobots.com")
    _uri(account["api_base_url"], "API base URL", ("https",))
    account["api_base_url"] = account["api_base_url"].rstrip("/")
    account.setdefault("version", "latest")
    _text(account["version"], "Wherobots runtime version", maximum=200)
    job = value.get("job")
    if not isinstance(job, dict) or set(job) - JOB_FIELDS:
        raise OperationError("JOB_FIELDS", "Use the documented native job fields.", details={"allowed": sorted(JOB_FIELDS)})
    name = _text(job.get("name"), "job name", maximum=255)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{8,255}", name):
        raise OperationError("JOB_NAME", "Use an 8–255 character job name containing letters, digits, underscores, periods or hyphens.")
    script = job.get("script")
    if not isinstance(script, dict) or not isinstance(script.get("object"), dict):
        raise OperationError("SCRIPT_REQUIRED", "Retain the original script before reviewing its workflow.")
    filename = _text(script.get("filename"), "script filename", maximum=255)
    if Path(filename).name != filename or "/" in filename or "\\" in filename or not filename.lower().endswith((".py", ".jar")):
        raise OperationError("SCRIPT_FILENAME", "Use the original Python or JAR filename.")
    obj = script["object"]
    path = workspace.object_path(obj.get("sha256"))
    if type(obj.get("bytes")) is not int or path.stat().st_size != obj["bytes"]:
        raise OperationError("SCRIPT_OBJECT", "The original script bytes do not match their retained descriptor.")
    if script.get("uri"):
        _uri(script["uri"], "existing script")
    if filename.lower().endswith(".jar"):
        _text(job.get("jar_main_class"), "JAR main class")
    args = job.setdefault("args", [])
    if not isinstance(args, list) or any(not isinstance(x, str) for x in args):
        raise OperationError("JOB_ARGUMENTS", "Supply native arguments as an ordered array of strings.")
    job.setdefault("timeout_seconds", 3600)
    if type(job["timeout_seconds"]) is not int or job["timeout_seconds"] <= 0:
        raise OperationError("JOB_TIMEOUT", "Use a positive native job timeout in seconds.")
    spark = job.setdefault("spark_configs", {})
    if not isinstance(spark, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in spark.items()):
        raise OperationError("SPARK_CONFIG", "Spark configuration keys and values must be strings.")
    for key in ("spark_driver_disk_gb", "spark_executor_disk_gb"):
        if key in job and (type(job[key]) is not int or job[key] < 0):
            raise OperationError("DISK_SIZE", "Native disk sizes must be nonnegative integers.")
    dependencies = job.setdefault("dependencies", [])
    if not isinstance(dependencies, list):
        raise OperationError("DEPENDENCIES", "Use an ordered list of native PyPI or remote file dependencies.")
    for dep in dependencies:
        if not isinstance(dep, dict) or dep.get("sourceType") not in {"PYPI", "FILE"}:
            raise OperationError("DEPENDENCY_TYPE", "Select a native PYPI or FILE dependency.")
        if dep["sourceType"] == "FILE":
            _uri(dep.get("filePath"), "dependency")
        else:
            _text(dep.get("libraryName"), "dependency name"); _text(dep.get("libraryVersion"), "dependency version")
    sources = value.setdefault("sources", [])
    if not isinstance(sources, list):
        raise OperationError("SOURCES", "List the original input collections or datasets.")
    seen = set()
    for source in sources:
        if not isinstance(source, dict):
            raise OperationError("SOURCE_OBJECT", "Each source must be an original source descriptor.")
        source_id = identifier(source.get("id"), "source ID")
        if source_id in seen:
            raise OperationError("SOURCE_DUPLICATE", "Use a distinct ID for each original source.")
        seen.add(source_id)
        _text(source.get("uri"), "source reference")
        if source.get("object"):
            workspace.object_path(source["object"].get("sha256"))
    outputs = value.get("outputs")
    if not isinstance(outputs, list) or not outputs:
        raise OperationError("OUTPUTS", "Define at least one complete output dataset.")
    seen = set()
    for output in outputs:
        if not isinstance(output, dict):
            raise OperationError("OUTPUT_OBJECT", "Each output must have its native store, path and format.")
        output_id = identifier(output.get("id"), "dataset ID")
        if output_id in seen:
            raise OperationError("OUTPUT_DUPLICATE", "Use a distinct output dataset ID.")
        seen.add(output_id)
        if output.get("store") not in {"my_files", "s3"} or output.get("format") not in FORMATS:
            raise OperationError("OUTPUT_FORMAT", "Select My Files or S3 and a documented original data format.")
        path = _text(output.get("path"), "output path")
        if output["store"] == "s3":
            _uri(path, "output")
            if urlsplit(path).scheme != "s3":
                raise OperationError("OUTPUT_STORE", "An S3 output requires its original s3:// URI.")
        elif path.startswith(("/", "\\")) or any(x in ("", ".", "..") for x in path.replace("\\", "/").rstrip("/").split("/")):
            raise OperationError("OUTPUT_PATH", "Select a path relative to My Files without traversal segments.")
        keys = output.setdefault("primary_key", [])
        if not isinstance(keys, list) or any(not isinstance(x, str) or not x for x in keys) or len(keys) != len(set(keys)):
            raise OperationError("OUTPUT_KEY", "Use distinct original column names for the optional comparison key.")
        csv = output.get("csv", {})
        if not isinstance(csv, dict) or ("header" in csv and type(csv["header"]) is not bool):
            raise OperationError("CSV_OPTIONS", "CSV options include a header flag, optional columns, delimiter and encoding.")
        if "delimiter" in csv and (not isinstance(csv["delimiter"], str) or len(csv["delimiter"]) != 1):
            raise OperationError("CSV_DELIMITER", "Select a one-character CSV delimiter.")
        if csv.get("header") is False and (not isinstance(csv.get("columns"), list) or not csv["columns"]):
            raise OperationError("CSV_COLUMNS", "Supply the original column names for headerless output.")
    limits = value.setdefault("limits", {})
    limits.setdefault("max_objects", 100)
    limits.setdefault("max_bytes", 2 * 1024 ** 3)
    for key in ("max_objects", "max_bytes"):
        if type(limits[key]) is not int or limits[key] <= 0:
            raise OperationError("RECEIVING_LIMIT", "Set positive receiving object and byte limits.")
    if len(canonical(value)) > 1024 * 1024:
        raise OperationError("WORKFLOW_SIZE", "Keep the workflow definition within 1 MiB and retain large originals as objects.")
    return value


def save_workflow(workspace, definition, expected_revision=None, actor="operator"):
    definition = validate_definition(workspace, definition)
    workflow_id = definition["id"]
    created_at = now()
    if expected_revision is not None:
        original = workspace.get_record("workflow", workflow_id)
        created_at = original["created_at"]
    body = {"id": workflow_id, "workflow_id": workflow_id, "schema": WORKFLOW_SCHEMA,
            "definition": definition, "created_at": created_at, "updated_at": now(), "updated_by": _text(actor, "operator")}
    return workspace.save_record("workflow", workflow_id, body, expected_revision)


def review(workspace, workflow_id, operation_id, expected_revision, actor, mode="submit"):
    identifier(operation_id, "operation ID")
    if mode not in {"submit", "attach"}:
        raise OperationError("REVIEW_MODE", "Review a new submission or an existing native run.")
    workflow = workspace.get_record("workflow", workflow_id)
    if workflow["revision_sha256"] != expected_revision:
        raise OperationError("WORKFLOW_CHANGED", "Reopen the current workflow before reviewing its native run.", status=409)
    definition = validate_definition(workspace, workflow["definition"])
    if mode == "attach" and not definition["job"]["script"].get("uri"):
        raise OperationError("ATTACH_SCRIPT_URI", "An existing-run review needs the original native script URI.")
    binding = {"workflow_id": workflow_id, "workflow_revision": expected_revision,
               "definition": definition, "operation_id": operation_id, "mode": mode}
    review_sha = digest(binding)
    name = definition["job"]["name"]
    native_name = name if mode == "attach" else name[:180] + "-" + digest([operation_id, review_sha])[:24]
    try:
        original = workspace.get_record("operation", operation_id)
    except OperationError as error:
        if error.status != 404:
            raise
    else:
        if original["review_sha256"] != review_sha:
            raise OperationError("OPERATION_REUSED", "This operation ID already belongs to another reviewed input.", status=409)
        return original
    return workspace.save_record("operation", operation_id, {
        "id": operation_id, "operation_id": operation_id, "workflow_id": workflow_id,
        "schema": "starforge.wherobots.operation.v1", "state": "REVIEWED",
        "reviewed_definition": definition, "workflow_revision": expected_revision,
        "review_sha256": review_sha, "reviewed_by": _text(actor, "reviewing operator"),
        "mode": mode, "native_name": native_name, "native_payload": None,
        "native_run_id": None, "native_status": None, "run_objects": [],
        "log_captures": [], "output_editions": [], "created_at": now(), "updated_at": now()})


def _save(workspace, operation, **changes):
    return workspace.save_record("operation", operation["id"],
        {**operation, **changes, "updated_at": now()}, operation["revision_sha256"])


def submit(workspace, operation_id, provider):
    with workspace.operation_lock(operation_id):
        operation = workspace.get_record("operation", operation_id)
        if operation["mode"] != "submit":
            raise OperationError("ATTACH_ONLY", "This reviewed operation attaches to its existing native run.")
        if operation.get("native_run_id"):
            return operation
        if operation["state"] not in {"REVIEWED", "UPLOAD_FAILED", "SCRIPT_READY"}:
            raise OperationError("RECONCILE_SUBMISSION", "Recover this original submission before starting another native job.",
                                 status=409, details={"operation_id": operation_id, "state": operation["state"]})
        provider.check_binding(operation["reviewed_definition"]["account"])
        if operation["state"] != "SCRIPT_READY":
            operation = _save(workspace, operation, state="UPLOADING_SCRIPT")
            try:
                script_uri = provider.upload_script(workspace, operation)
                payload = provider.payload(operation, script_uri)
            except Exception as error:
                _save(workspace, operation, state="UPLOAD_FAILED", last_error=provider.error(error))
                raise
            operation = _save(workspace, operation, state="SCRIPT_READY", script_uri=script_uri, native_payload=payload)
        operation = _save(workspace, operation, state="SUBMITTING", submitted_at=now())
        try:
            run_id = provider.submit(operation)
        except Exception as error:
            _save(workspace, operation, state="SUBMIT_UNCERTAIN", last_error=provider.error(error))
            raise
        if not isinstance(run_id, str) or not run_id:
            return _save(workspace, operation, state="SUBMIT_UNCERTAIN",
                         last_error={"code": "RUN_ID_MISSING", "message": "The provider returned no native run ID."})
        operation = _save(workspace, operation, state="SUBMITTED", native_run_id=run_id)
        workspace.event("operation", operation_id, {"kind": "NATIVE_SUBMITTED", "native_run_id": run_id})
        return operation


def recover(workspace, operation_id, provider, native_run_id=None):
    with workspace.operation_lock(operation_id):
        operation = workspace.get_record("operation", operation_id)
        provider.check_binding(operation["reviewed_definition"]["account"])
        if operation.get("native_run_id"):
            return operation
        if operation["mode"] == "attach":
            operation = _save(workspace, operation, native_payload=provider.payload(
                operation, operation["reviewed_definition"]["job"]["script"]["uri"]))
        if not operation.get("native_payload"):
            if operation["state"] == "UPLOADING_SCRIPT":
                return _save(workspace, operation, state="UPLOAD_FAILED",
                    last_error={"code": "UPLOAD_INTERRUPTED", "message": "The native submission had not started; resume the same retained script upload."})
            raise OperationError("SUBMIT_NOT_STARTED", "The operation has no prepared native submission to recover.")
        views, listing_objects = provider.find_run(workspace, operation, native_run_id=native_run_id)
        exact = [view for view in views if provider.matches(operation, view)]
        if len(exact) != 1:
            return _save(workspace, operation, state="RECOVERY_REVIEW", recovery={
                "captured_at": now(), "exact_matches": len(exact),
                "candidate_ids": [view.get("id") for view in views], "listing_objects": listing_objects})
        view = exact[0]
        retained = workspace.put_object(canonical(view))
        operation = _save(workspace, operation, native_run_id=view["id"], native_status=view.get("status"),
                          state="ATTACHED" if operation["mode"] == "attach" else "SUBMITTED",
                          run_objects=operation["run_objects"] + [retained],
                          recovery={"captured_at": now(), "exact_matches": 1, "listing_objects": listing_objects})
        workspace.event("operation", operation_id, {"kind": "NATIVE_RUN_RECOVERED", "native_run_id": view["id"]})
        return operation


def refresh(workspace, operation_id, provider, include_logs=False):
    with workspace.operation_lock(operation_id):
        operation = workspace.get_record("operation", operation_id)
        if not operation.get("native_run_id"):
            raise OperationError("RUN_REQUIRED", "Submit or recover the original native run first.")
        provider.check_binding(operation["reviewed_definition"]["account"])
        snapshot = provider.snapshot(workspace, operation, include_logs=include_logs)
        view = snapshot["run"]
        if not provider.matches(operation, view):
            raise OperationError("RUN_ASSOCIATION", "The native run no longer matches its reviewed account, script and arguments.", status=409)
        status = view.get("status")
        changes = {"native_status": status, "state": status or "STATUS_UNKNOWN",
                   "terminal": status in {"COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"},
                   "run_objects": operation["run_objects"] + [snapshot["run_object"]],
                   "latest_metrics": snapshot.get("metrics"), "latest_cost": snapshot.get("cost")}
        if snapshot.get("logs"):
            changes["log_captures"] = operation["log_captures"] + [snapshot["logs"]]
        return _save(workspace, operation, **changes)


def cancel(workspace, operation_id, provider):
    with workspace.operation_lock(operation_id):
        operation = workspace.get_record("operation", operation_id)
        if not operation.get("native_run_id"):
            raise OperationError("RUN_REQUIRED", "Recover the original native run before requesting cancellation.")
        provider.check_binding(operation["reviewed_definition"]["account"])
        response = provider.cancel(operation)
        workspace.event("operation", operation_id, {"kind": "NATIVE_CANCEL_REQUEST", "response": response})
        return _save(workspace, operation, cancellation={"requested_at": now(), "response": response})


def capture_outputs(workspace, operation_id, provider):
    from .editions import create_edition
    with workspace.operation_lock(operation_id):
        operation = workspace.get_record("operation", operation_id)
        if operation.get("native_status") != "COMPLETED":
            raise OperationError("COMPLETE_RUN_REQUIRED", "Refresh the original run and select its completed output edition.")
        provider.check_binding(operation["reviewed_definition"]["account"])
        datasets = provider.capture_outputs(workspace, operation)
        edition = create_edition(workspace, operation_id, datasets)
        ids = list(dict.fromkeys(operation.get("output_editions", []) + [edition["id"]]))
        _save(workspace, operation, output_editions=ids)
        return edition

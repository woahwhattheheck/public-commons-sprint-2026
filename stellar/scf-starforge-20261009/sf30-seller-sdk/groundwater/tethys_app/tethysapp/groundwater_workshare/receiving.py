"""Receive one actual complete backup into an existing configured Tethys portal.

Run in the selected portal environment:
python -m tethysapp.groundwater_workshare.receiving --input ABSOLUTE_JSON
The input names an existing account, a new private slot, exact archive identity,
and original source/run/report/operation selections. No solver is dispatched.
"""
from contextlib import contextmanager
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys

SCHEMA = "groundwater.tethys-receiving-input.v1"


def _require(condition, code, message, **detail):
    if not condition:
        from .policy import PortalProblem
        raise PortalProblem(code, message, 409, **detail)


def _unique(pairs):
    output = {}
    for key, value in pairs:
        if key in output:
            raise ValueError("A JSON key is repeated: " + key)
        output[key] = value
    return output


def _bad_constant(value):
    raise ValueError("Nonfinite JSON is not supported: " + value)


def load_input(path):
    path = Path(path).expanduser()
    if not path.is_absolute() or path.is_symlink():
        raise ValueError("Use an absolute original input JSON file, not a link.")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1048576:
            raise ValueError("The original receiving input must be a regular JSON file of at most one MiB.")
        with os.fdopen(fd, "rb") as stream:
            fd = None
            raw = stream.read(1048577)
    finally:
        if fd is not None:
            os.close(fd)
    if len(raw) > 1048576:
        raise ValueError("The retained receiving input exceeds one MiB.")
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique, parse_constant=_bad_constant)
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Use the original groundwater.tethys-receiving-input.v1 request.")
    allowed = {"schema", "operation_id", "user", "slot", "archive", "expected", "report_receivings"}
    if set(value) != allowed:
        raise ValueError("The receiving request has missing or unsupported fields.")
    return value


def _sha(value):
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def _list(value, name, *, nonempty=True):
    _require(isinstance(value, list) and len(value) <= 500 and (value or not nonempty),
             "portal_receiving_selection", "Use an explicit bounded original selection.", field=name)
    return value


def validate_input(value):
    from .policy import validate_slot
    from groundwater_workspace.common import identifier
    validate_slot(value["operation_id"])
    validate_slot(value["slot"])
    _require(isinstance(value["user"], str) and bool(value["user"]) and len(value["user"]) <= 256,
             "portal_receiving_user", "Select one exact existing Tethys account.")
    archive = value["archive"]
    _require(isinstance(archive, dict) and set(archive) == {"path", "bytes", "sha256"},
             "portal_receiving_archive", "Bind the exact completed archive path, bytes and SHA-256.")
    _require(isinstance(archive["path"], str) and Path(archive["path"]).is_absolute()
             and ".." not in Path(archive["path"]).parts and _sha(archive["sha256"])
             and type(archive["bytes"]) is int and archive["bytes"] > 0,
             "portal_receiving_archive", "The original archive identity is invalid.")
    expected = value["expected"]
    fields = {"workspace_id", "workspace_version", "project_id", "source_ids", "edition_ids", "runs", "reports", "operations"}
    _require(isinstance(expected, dict) and set(expected) == fields,
             "portal_receiving_expected", "Supply the complete original workspace and selected-record identities.")
    identifier(expected["workspace_id"]); identifier(expected["project_id"])
    _require(type(expected["workspace_version"]) is int and expected["workspace_version"] >= 0,
             "portal_receiving_expected", "Use the original archive's workspace version.")
    for name in ("source_ids", "edition_ids"):
        items = _list(expected[name], name)
        for item in items:
            identifier(item)
        _require(len(items) == len(set(items)), "portal_receiving_selection", "An original selection contains duplicate IDs.", field=name)
    required = {
        "runs": {"id", "result_sha256"},
        "reports": {"id", "report_sha256", "archive_sha256", "archive_bytes"},
        "operations": {"id", "request_sha256", "result_sha256"},
    }
    for name, keys in required.items():
        items = _list(expected[name], name)
        ids = []
        for item in items:
            _require(isinstance(item, dict) and set(item) == keys, "portal_receiving_selection", "A selected original record has missing or extra identity fields.", field=name)
            identifier(item["id"]); ids.append(item["id"])
            for key in keys - {"id", "archive_bytes"}:
                _require(_sha(item[key]), "portal_receiving_selection", "Use the exact retained record SHA-256.", field=name + "." + key)
            if "archive_bytes" in keys:
                _require(type(item["archive_bytes"]) is int and item["archive_bytes"] > 0,
                         "portal_receiving_selection", "Use the exact original report archive byte count.")
        _require(len(ids) == len(set(ids)), "portal_receiving_selection", "Select each original record only once.", field=name)
    report_ids = {row["id"] for row in expected["reports"]}
    names = []
    for item in _list(value["report_receivings"], "report_receivings"):
        _require(isinstance(item, dict) and set(item) == {"report_id", "name"} and item["report_id"] in report_ids,
                 "portal_receiving_report", "Receive an explicitly selected original frozen report.")
        validate_slot(item["name"]); names.append(item["name"])
    _require(len(names) == len(set(names)), "portal_receiving_report", "Each original report receiving destination must have a distinct name.")


@contextmanager
def record_lock(parent, operation_id):
    from .policy import private_directory
    parent = private_directory(parent, create=True)
    fd = os.open(
        parent / (operation_id + ".lock"),
        os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
        0o600,
    )
    try:
        info = os.fstat(fd)
        _require(stat.S_ISREG(info.st_mode) and not stat.S_IMODE(info.st_mode) & 0o077
                 and (not hasattr(os, "geteuid") or info.st_uid == os.geteuid()),
                 "portal_receiving_lock", "The retained receiving lock is not a private regular file.")
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield private_directory(parent / operation_id, create=True)
    finally:
        os.close(fd)


def _original_database_identity(context, package):
    from groundwater_workspace.common import verify_file
    row = next((row for row in package["manifest"]["files"] if row["path"] == "workspace/groundwater.sqlite"), None)
    _require(row is not None, "portal_receiving_database", "The complete archive lacks its original database.")
    original = context.container / "received" / row["path"]
    verify_file(original, row)
    connection = sqlite3.connect(original.as_uri() + "?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        meta = dict(connection.execute("SELECT key,value FROM meta"))
        return {"id": meta["id"], "version": int(meta["version"]), "database": row}
    finally:
        connection.close()


def verify_current(workbench, expected):
    """Use maintained verified readers, without rewriting their domain results."""
    from groundwater_workspace.common import digest
    state = workbench.state(expected["project_id"])
    _require(state["workspace"]["id"] == expected["workspace_id"],
             "portal_receiving_workspace", "The current slot is not the original received workspace.")
    sources, editions, runs, reports, operations = [], [], [], [], []
    for source_id in expected["source_ids"]:
        source = workbench.source_detail(source_id)["source"]
        _require(source["project_id"] == expected["project_id"],
                 "portal_receiving_source", "A selected source belongs to another project.")
        members = []
        for row in source["files"]:
            verified = workbench.source_file(source_id, row["path"])
            members.append({"path": row["path"], "bytes": verified["bytes"], "sha256": verified["sha256"]})
        sources.append({"id": source_id, "sha256": source["sha256"], "files": members})
    for edition_id in expected["edition_ids"]:
        edition = workbench.edition_detail(edition_id)["edition"]
        _require(edition["project_id"] == expected["project_id"] and edition["source_id"] in expected["source_ids"],
                 "portal_receiving_edition", "A selected edition is outside the retained project/source selection.")
        editions.append({"id": edition_id, "source_id": edition["source_id"], "sha256": edition["sha256"]})
    for selected in expected["runs"]:
        detail = workbench.run_detail(selected["id"])
        run, result = detail["run"], detail.get("result")
        _require(run["project_id"] == expected["project_id"] and run["edition_id"] in expected["edition_ids"]
                 and result is not None and digest(result) == selected["result_sha256"],
                 "portal_receiving_native_result", "The original completed run result is unavailable or changed.", run_id=selected["id"])
        members = []
        for row in result["files"]:
            verified = workbench.run_file(selected["id"], row["path"])
            members.append({"path": row["path"], "bytes": verified["bytes"], "sha256": verified["sha256"]})
        runs.append({"id": selected["id"], "edition_id": run["edition_id"], "state": run["state"],
                     "result_sha256": digest(result), "files": members})
    for selected in expected["reports"]:
        detail = workbench.report_detail(selected["id"])
        report = detail["report"]
        _require(report["project_id"] == expected["project_id"] and report["sha256"] == selected["report_sha256"]
                 and digest(detail["snapshot"]) == selected["report_sha256"],
                 "portal_receiving_report", "The original frozen report edition changed.", report_id=selected["id"])
        formats = {}
        for name in ("zip", "json", "html", "csv"):
            descriptor = workbench.report_export(selected["id"], name)
            formats[name] = {key: descriptor[key] for key in ("filename", "mime", "bytes", "sha256")}
        _require(formats["zip"]["sha256"] == selected["archive_sha256"]
                 and formats["zip"]["bytes"] == selected["archive_bytes"],
                 "portal_receiving_report_archive", "The original report ZIP differs from the supplied receiving identity.")
        reports.append({"id": selected["id"], "report_sha256": report["sha256"], "formats": formats,
                        "delivery_ids": [row["id"] for row in detail["deliveries"]],
                        "acknowledgment_ids": [row["id"] for row in detail["acknowledgments"]]})
    for selected in expected["operations"]:
        operation = workbench.operation(selected["id"])
        _require(operation["state"] == "committed"
                 and operation["request_sha256"] == selected["request_sha256"]
                 and digest(operation["result"]) == selected["result_sha256"],
                 "portal_receiving_operation", "An original request or committed result changed.", operation_id=selected["id"])
        operations.append({"id": selected["id"], "action": operation["action"],
                           "request_sha256": operation["request_sha256"], "result_sha256": digest(operation["result"])})
    return {
        "workspace": state["workspace"], "project": state["project"],
        "sources": sources, "editions": editions, "runs": runs, "reports": reports,
        "operations": operations,
        "original_receivers": state["receivers"],
        "original_deliveries": state["deliveries"],
        "later_workspace_version": state["workspace"]["version"] != expected["workspace_version"],
    }


def run(value):
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "tethys_portal.settings")
    import django
    django.setup()
    from django.contrib.auth import get_user_model
    from django.urls import reverse
    from tethys_apps.models import TethysApp
    from groundwater_workspace import Workbench
    import groundwater_workspace
    from groundwater_workspace.common import digest, file_info, verify_file
    from groundwater_workspace.delivery import inspect_package, receive_package, restore_workspace
    from .app import App
    from .creation import _publish, _read
    from .policy import configuration, context_for_user, private_directory, portal_binding

    validate_input(value)
    _require(sys.version_info >= (3, 11), "portal_receiving_python", "This composed installation requires Python 3.11 or later.")
    versions = {
        "portal": importlib.metadata.version("tethys-platform"),
        "core": importlib.metadata.version("starforge-groundwater-workspace"),
    }
    _require(versions == {"portal": "4.6.1", "core": "1.0.0"},
             "portal_receiving_installation", "Use the selected original portal/core installation for this native receiving.", installed=versions)
    users = get_user_model()
    user = users._default_manager.get(**{users.USERNAME_FIELD: value["user"]})
    _require(user.is_active, "portal_receiving_user", "The existing portal account must be active.")
    db_app = TethysApp.objects.get(package=App.package)
    def permission(name):
        _require(user.has_perm("tethys_apps." + App.package + ":" + name, db_app),
                 "portal_permission_required", "The selected account lacks an original receiving permission.", permission=name)
    for name in ("view_workspace", "backup_workspace", "receive_reports"):
        permission(name)
    config = configuration()
    if config["workspace_scope"] == "app":
        permission("use_shared_workspace")
    context = context_for_user(user, value["slot"], config=config, create_roots=True)
    bound = {
        "schema": "groundwater.tethys-receiving-request.v1",
        "request": value,
        "request_sha256": digest(value),
        "user_id": str(user.pk),
        "scope": context.scope,
        "root": str(context.root),
        "container": str(context.container),
        "workspace": str(context.workspace),
        "portal_binding": portal_binding(context, user),
    }
    with record_lock(context.root / "portal_receiving", value["operation_id"]) as record:
        request_path = record / "request.json"
        saved = _read(request_path, limit=2097152)
        if saved is None:
            _require(not context.container.exists() and not context.container.is_symlink()
                     and not (context.root / "creation_intents" / (context.slot + ".json")).exists(),
                     "portal_receiving_slot_occupied", "Use a new absent slot, preserving every existing creation/restore.")
            for receiving in value["report_receivings"]:
                destination = context.reports / receiving["name"]
                _require(not destination.exists() and not destination.is_symlink(),
                         "portal_receiving_report_occupied", "Use a new absent report receiving name.")
        else:
            _require(saved == bound, "portal_receiving_request_changed",
                     "This original receiving ID belongs to a different archive, account, scope, slot or selected evidence.")
        _publish(request_path, bound)  # Before either original restore or report receive.
        archive = Path(value["archive"]["path"])
        _require(not archive.is_symlink(), "portal_receiving_archive", "The original backup path must be a regular file.")
        verify_file(archive, value["archive"])
        package = inspect_package(archive)
        _require(package["manifest"]["kind"] == "workspace_backup"
                 and package["manifest"]["workspace_id"] == value["expected"]["workspace_id"],
                 "portal_receiving_archive", "This is not the supplied original complete workspace backup.")
        # Original core handles the same request's partial target publication.
        # Neither this caller nor the portal rewrites its control markers.
        restored = restore_workspace(archive, context.container)
        _require(restored["workspace_id"] == value["expected"]["workspace_id"]
                 and restored["archive_sha256"] == value["archive"]["sha256"]
                 and Path(restored["workspace"]) == context.workspace
                 and restored["original_operations_preserved"] is True
                 and restored["automatic_run"] is False,
                 "portal_receiving_restore", "The original restore result does not bind this selected private slot.")
        context.require_existing()
        original = _original_database_identity(context, package)
        _require(original["id"] == value["expected"]["workspace_id"]
                 and original["version"] == value["expected"]["workspace_version"],
                 "portal_receiving_original_database", "The immutable incoming database differs from the supplied original identity.")
        with Workbench(context.workspace, existing_only=True) as workbench:
            verified = verify_current(workbench, value["expected"])
            received_reports = []
            for item in value["report_receivings"]:
                descriptor = workbench.report_export(item["report_id"], "zip")
                receipt = receive_package(descriptor["path"], context.reports / item["name"])
                _require(receipt["receipt"]["report_id"] == item["report_id"]
                         and receipt["receipt"]["archive_sha256"] == descriptor["sha256"],
                         "portal_receiving_report", "The independent report receipt does not match its original ZIP.")
                received_reports.append({"receipt": receipt["receipt"], "directory": receipt["directory"],
                                         "manifest": file_info(Path(receipt["directory"]) / "manifest.json")})
            installed_application = str(workbench.application)
        route = reverse("groundwater_workshare:workspace", kwargs={
            "portal_id": bound["portal_binding"], "slot": context.slot,
            "workspace_id": value["expected"]["workspace_id"],
        })
        result_path = record / "result.json"
        result = _read(result_path, limit=67108864)
        if result is None:
            result = {
                "schema": "groundwater.tethys-receiving-result.v1",
                "operation_id": value["operation_id"], "request_sha256": bound["request_sha256"],
                "actor": user.get_username(), "user_id": str(user.pk),
                "installed": {**versions, "python": sys.version.split()[0],
                              "core_module": str(Path(groundwater_workspace.__file__).resolve()),
                              "core_module_identity": file_info(Path(groundwater_workspace.__file__)),
                              "application": installed_application},
                "paths": context.as_dict(), "portal_path": route,
                "archive": value["archive"], "original_database": original,
                "restore": restored, "verified": verified, "report_receivings": received_reports,
                "native_runs_started": 0, "patient_or_customer_acceptance": False,
                "received_at": datetime.now(timezone.utc).isoformat(),
            }
            _publish(result_path, result)
        else:
            _require(result.get("operation_id") == value["operation_id"]
                     and result.get("request_sha256") == bound["request_sha256"]
                     and result.get("portal_path") == route,
                     "portal_receiving_result_changed", "The retained receiving result differs from its original request/address.")
        handoff = {
            "schema": "groundwater.tethys-browser-handoff.v1",
            "operation_id": value["operation_id"], "request_sha256": bound["request_sha256"],
            "actor": result["actor"], "user_id": result["user_id"],
            "portal_path": route, "slot": context.slot,
            "workspace_id": value["expected"]["workspace_id"], "project_id": value["expected"]["project_id"],
            "selected_reports": [row["id"] for row in value["expected"]["reports"]],
            "selected_runs": [row["id"] for row in value["expected"]["runs"]],
            "selected_operations": [row["id"] for row in value["expected"]["operations"]],
            "receiving_result": {"path": str(result_path), **file_info(result_path)},
            "existing_account_login_required": True,
            "native_runs_started": 0,
        }
        _publish(record / "portal-handoff.json", handoff)
        return {
            "schema": "groundwater.tethys-receiving-readback.v1",
            "original_result": result,
            "current": {"workspace": verified["workspace"], "project": verified["project"],
                        "later_workspace_version": verified["later_workspace_version"],
                        "selected_originals_verified": True},
            "result_file": {"path": str(result_path), **file_info(result_path)},
            "handoff_file": {"path": str(record / "portal-handoff.json"), **file_info(record / "portal-handoff.json")},
            "portal_path": route, "native_runs_started": 0,
        }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Exact retained original receiving JSON.")
    args = parser.parse_args(argv)
    original_umask = os.umask(0o077)
    try:
        result = run(load_input(args.input))
        print(json.dumps(result, sort_keys=True, ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except Exception as error:
        problem = error.as_dict() if hasattr(error, "as_dict") else {"code": type(error).__name__, "message": str(error)}
        print(json.dumps({"error": problem, "native_runs_started": 0}, sort_keys=True, ensure_ascii=False, allow_nan=False),
              file=sys.stderr, flush=True)
        return 2
    finally:
        os.umask(original_umask)


if __name__ == "__main__":
    raise SystemExit(main())

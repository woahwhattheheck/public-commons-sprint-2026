"""Operate this adapter's existing portal Paths; never execute a solver.

Run from the already configured Tethys service environment:
python -m tethysapp.groundwater_workshare.manage --user EXISTING_ACCOUNT check
"""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlencode


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--user", required=True, help="Exact existing active Tethys account identifier.")
    result.add_argument("--slot", help="Explicit private named slot; defaults to the portal setting.")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="Read installed portal/core/configuration and existing workspace metadata.")
    commands.add_parser("paths", help="Return original Paths destinations without opening or creating a database.")
    commands.add_parser("prepare-slot", help="Prepare private parent/receiving paths; leave the create-only restore destination absent.")
    receiver = commands.add_parser("prepare-receiver", help="Create one private subdirectory in the slot's receiving root.")
    receiver.add_argument("--name", required=True)
    report = commands.add_parser("prepare-report", help="Return one absent create-only frozen-report receiving destination.")
    report.add_argument("--name", required=True)
    return result


def _version(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def run(arguments):
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "tethys_portal.settings")
    import django
    django.setup()
    from django.contrib.auth import get_user_model
    from django.urls import reverse
    from tethys_apps.models import TethysApp
    from .app import App
    from .policy import (
        PERMISSIONS, PortalProblem, configuration, context_for_user,
        private_directory, validate_slot,
    )

    users = get_user_model()
    try:
        user = users._default_manager.get(**{users.USERNAME_FIELD: arguments.user})
    except users.DoesNotExist:
        raise PortalProblem("portal_account_missing", "Use the exact identifier of an existing Tethys account.", 404)
    if not user.is_active:
        raise PortalProblem("portal_account_inactive", "The selected Tethys account is inactive.", 403)
    db_app = TethysApp.objects.get(package=App.package)
    permissions = {
        name: bool(user.has_perm("tethys_apps." + App.package + ":" + name, db_app))
        for name in PERMISSIONS
    }
    config = configuration()
    if config["workspace_scope"] == "app" and not permissions["use_shared_workspace"]:
        raise PortalProblem("portal_permission_required", "The selected account cannot use the configured shared workspace.", 403, permission="use_shared_workspace")
    if arguments.command != "check" and not permissions["view_workspace"]:
        raise PortalProblem("portal_permission_required", "The selected account cannot open this application.", 403, permission="view_workspace")
    slot = arguments.slot or config["default_slot"]
    validate_slot(slot)
    portal_path = reverse("groundwater_workshare:home") + "?" + urlencode({"workspace": slot})
    if arguments.command == "check":
        result = {
            "schema": "groundwater.tethys-installation.v1",
            "actor": user.get_username(),
            "python": sys.version.split()[0],
            "portal_version": _version("tethys-platform"),
            "supported_portal_version": "4.6.1",
            "configuration": config,
            "permissions": permissions,
            "portal_path": portal_path,
            "original_workspace": None,
            "native_runtime": None,
            "issues": [],
            "executed": False,
        }
        if result["portal_version"] != "4.6.1":
            result["issues"].append({
                "code": "portal_version_unverified",
                "message": "This adapter's source contract is pinned to Tethys 4.6.1.",
            })
        if sys.version_info < (3, 11):
            result["issues"].append({"code": "python_version", "message": "The composed product requires Python 3.11 or later."})
        if not permissions["view_workspace"]:
            result["issues"].append({"code": "portal_permission_required", "permission": "view_workspace"})
        try:
            from groundwater_workspace import Workbench
            import groundwater_workspace
            result["core_module"] = str(Path(groundwater_workspace.__file__).resolve())
        except ImportError:
            result["issues"].append({"code": "core_not_installed", "message": "Install the reviewed original groundwater core into this same portal environment."})
            return result
        try:
            context = context_for_user(user, slot, config=config, create_roots=False)
        except PortalProblem as error:
            result["paths_status"] = error.as_dict()
            return result
        result["paths"] = context.as_dict()
        if (context.workspace / "groundwater.sqlite").exists():
            context.require_existing()
            with Workbench(context.workspace, existing_only=True) as workbench:
                result["original_workspace"] = workbench.state()["workspace"]
                result["native_runtime"] = workbench.runtime()
        return result

    prepare = arguments.command in ("paths", "prepare-slot", "prepare-receiver", "prepare-report")
    context = context_for_user(user, slot, config=config, create_roots=prepare)
    result = {
        "schema": "groundwater.tethys-private-paths.v1",
        "actor": user.get_username(),
        **context.as_dict(),
        "portal_path": portal_path,
        "database_created": False,
        "executed": False,
    }
    if arguments.command == "prepare-slot":
        if not (permissions["backup_workspace"] or permissions["edit_workspace"]):
            raise PortalProblem("portal_permission_required", "The selected account cannot prepare a workspace receiving slot.", 403)
        if context.container.exists() or context.container.is_symlink() or (context.root / "creation_intents" / (slot + ".json")).exists():
            raise PortalProblem("portal_slot_exists", "The original restore destination already exists. Select a new slot; retained material was not replaced.", 409)
        result["restore_destination_absent"] = True
    elif arguments.command == "prepare-receiver":
        if not permissions["receive_reports"]:
            raise PortalProblem("portal_permission_required", "The selected account cannot configure receiving.", 403, permission="receive_reports")
        name = validate_slot(arguments.name)
        destination = context.receiving / name
        created = not destination.exists()
        private_directory(destination, create=True)
        result["receiver_directory"] = str(destination)
        result["created"] = created
    elif arguments.command == "prepare-report":
        if not permissions["receive_reports"]:
            raise PortalProblem("portal_permission_required", "The selected account cannot receive a frozen report.", 403, permission="receive_reports")
        name = validate_slot(arguments.name)
        destination = context.reports / name
        if destination.exists() or destination.is_symlink():
            raise PortalProblem("portal_report_destination_exists", "Select a new report receiving name; the original destination remains unchanged.", 409)
        result["report_destination"] = str(destination)
        result["report_destination_absent"] = True
    return result


def main(argv=None):
    arguments = parser().parse_args(argv)
    try:
        result = run(arguments)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True))
        return 2 if result.get("issues") else 0
    except Exception as error:
        body = error.as_dict() if hasattr(error, "as_dict") else {
            "code": "portal_installation_failed",
            "message": str(error),
        }
        print(json.dumps({"error": body}, ensure_ascii=False, allow_nan=False, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

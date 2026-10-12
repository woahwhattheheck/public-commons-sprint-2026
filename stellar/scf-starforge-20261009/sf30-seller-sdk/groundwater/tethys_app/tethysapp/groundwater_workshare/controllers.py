"""Tethys controllers delegating to the maintained original Workbench."""
import importlib.metadata
import uuid
from pathlib import Path
from urllib.parse import urlencode

from django.http import HttpResponse, HttpResponseRedirect
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.urls import reverse
from tethys_sdk.permissions import has_permission
from tethys_sdk.routing import controller

from groundwater_workspace import Workbench
from groundwater_workspace.common import json_text

from .policy import (
    ACTION_PERMISSIONS, SLOT, PortalProblem, bind_workspace, check_receiver_action,
    configuration, context_for_request, permissions_for, require_permission, portal_binding,
)
from .transport import endpoint, file_response, json_response, query_value, read_json
from .creation import create_or_continue, recoverable_creations

NAMESPACE = "groundwater_workshare"


def url(name, **kwargs):
    return reverse(NAMESPACE + ":" + name, kwargs=kwargs or None)


def workspace_url(portal_id, slot, workspace_id):
    return url("workspace", portal_id=portal_id, slot=slot, workspace_id=workspace_id)


@controller(name="home", url="", login_required=True)
@endpoint(bound=False)
def home(request):
    config = configuration()
    selected = query_value(request, "workspace", maximum=64)
    if selected:
        context = context_for_request(request, selected, create_roots=True)
        context.require_existing()
        with Workbench(context.workspace, existing_only=True) as workbench:
            identity = workbench.state()["workspace"]["id"]
        return HttpResponseRedirect(workspace_url(portal_binding(context, request.user), selected, identity))
    context = context_for_request(request, config["default_slot"], create_roots=True)
    intents = recoverable_creations(context, request.user)
    slots = []
    for candidate in sorted((context.root / "workspaces").iterdir(), key=lambda p: p.name):
        if not SLOT.fullmatch(candidate.name) or candidate.is_symlink() or not candidate.is_dir():
            continue
        slots.append({
            "name": candidate.name,
            "creation_id": intents.get(candidate.name, {}).get("creation_id"),
            "database_present": (candidate / "workspace" / "groundwater.sqlite").is_file(),
            "url": url("home") + "?" + urlencode({"workspace": candidate.name}),
        })
    present = {item["name"] for item in slots}
    for name, intent in intents.items():
        if name not in present:
            slots.append({"name": name, "database_present": False, "url": None, **intent})
    slots.sort(key=lambda item: item["name"])
    get_token(request)
    return render(request, "groundwater_workshare/launcher.html", {
        "actor": request.user.get_username(),
        "scope": context.scope,
        "default_slot": config["default_slot"],
        "slots": slots,
        "home_url": url("home"),
        "create_url": url("create_workspace"),
        "new_creation_id": str(uuid.uuid4()),
        "default_exists": (context.workspace / "groundwater.sqlite").is_file(),
        "can_create": has_permission(request, "edit_workspace"),
        "permissions": permissions_for(request),
        "default_url": url("home") + "?" + urlencode({"workspace": config["default_slot"]}),
    })


@controller(name="create_workspace", url="create-workspace", login_required=False)
@endpoint(methods=("POST",), permission="edit_workspace", bound=False)
def create_workspace(request):
    if request.content_type != "application/x-www-form-urlencoded":
        raise PortalProblem("portal_form_required", "Use the existing portal's Create workspace form.", 415)
    values = request.POST.getlist("workspace")
    identifiers = request.POST.getlist("creation_id")
    if len(values) != 1 or len(identifiers) != 1:
        raise PortalProblem("portal_slot_required", "Use one original workspace slot and creation identifier from this form.")
    context = context_for_request(request, values[0], create_roots=True)
    identity = create_or_continue(context, request.user, identifiers[0])
    return HttpResponseRedirect(workspace_url(portal_binding(context, request.user), context.slot, identity))


@controller(name="workspace", url="w/{portal_id}/{slot}/{workspace_id}/", login_required=False)
@endpoint()
def workspace(request, workbench, context, portal_id, slot, workspace_id):
    return file_response(request, workbench.static_file("index.html"), attachment=False)


@controller(name="bootstrap", url="w/{portal_id}/{slot}/{workspace_id}/bootstrap.js", login_required=False)
@endpoint()
def bootstrap(request, workbench, context, portal_id, slot, workspace_id):
    base = workspace_url(portal_id, slot, workspace_id)
    state_url = url("state", portal_id=portal_id, slot=slot, workspace_id=workspace_id)
    config = {
        "apiBase": state_url.removesuffix("/state"),
        "assetBase": base.rstrip("/"),
        "guideUrl": url("guide", portal_id=portal_id, slot=slot, workspace_id=workspace_id),
        "csrfToken": get_token(request),
        "actor": request.user.get_username(),
        "receiverDirectory": str(context.receiving),
        "portal": {
            "homeUrl": url("home"),
            "workspaceId": workspace_id,
            "slot": slot,
            "scope": context.scope,
            "permissions": permissions_for(request),
        },
    }
    text = json_text(config).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return HttpResponse(
        "window.GROUNDWATER_CONFIG = Object.freeze(" + text + ");\n",
        content_type="application/javascript; charset=utf-8",
    )


@controller(name="app_script", url="w/{portal_id}/{slot}/{workspace_id}/app.js", login_required=False)
@endpoint()
def app_script(request, workbench, context, portal_id, slot, workspace_id):
    return file_response(request, workbench.static_file("app.js"), attachment=False)


@controller(name="app_style", url="w/{portal_id}/{slot}/{workspace_id}/style.css", login_required=False)
@endpoint()
def app_style(request, workbench, context, portal_id, slot, workspace_id):
    return file_response(request, workbench.static_file("style.css"), attachment=False)


@controller(name="guide", url="w/{portal_id}/{slot}/{workspace_id}/guide", login_required=False)
@endpoint()
def guide(request, workbench, context, portal_id, slot, workspace_id):
    return file_response(request, workbench.guide_file())


@controller(name="state", url="w/{portal_id}/{slot}/{workspace_id}/api/state", login_required=False)
@endpoint()
def state(request, workbench, context, portal_id, slot, workspace_id):
    return json_response(workbench.state(query_value(request, "project_id", maximum=128)))


@controller(name="runtime", url="w/{portal_id}/{slot}/{workspace_id}/api/runtime", login_required=False)
@endpoint()
def runtime(request, workbench, context, portal_id, slot, workspace_id):
    return json_response(workbench.runtime())


@controller(name="operation", url="w/{portal_id}/{slot}/{workspace_id}/api/operations/{operation_id}", login_required=False)
@endpoint()
def operation(request, workbench, context, portal_id, slot, workspace_id, operation_id):
    return json_response(workbench.operation(operation_id))


@controller(name="source", url="w/{portal_id}/{slot}/{workspace_id}/api/sources/{source_id}", login_required=False)
@endpoint()
def source(request, workbench, context, portal_id, slot, workspace_id, source_id):
    return json_response(workbench.source_detail(source_id))


@controller(name="source_original", url="w/{portal_id}/{slot}/{workspace_id}/api/sources/{source_id}/original", login_required=False)
@endpoint()
def source_original(request, workbench, context, portal_id, slot, workspace_id, source_id):
    return file_response(request, workbench.source_file(source_id, query_value(request, "path", required=True)))


@controller(name="edition", url="w/{portal_id}/{slot}/{workspace_id}/api/editions/{edition_id}", login_required=False)
@endpoint()
def edition(request, workbench, context, portal_id, slot, workspace_id, edition_id):
    return json_response(workbench.edition_detail(edition_id))


@controller(name="run", url="w/{portal_id}/{slot}/{workspace_id}/api/runs/{run_id}", login_required=False)
@endpoint()
def run(request, workbench, context, portal_id, slot, workspace_id, run_id):
    return json_response(workbench.run_detail(run_id))


@controller(name="run_file", url="w/{portal_id}/{slot}/{workspace_id}/api/runs/{run_id}/file", login_required=False)
@endpoint()
def run_file(request, workbench, context, portal_id, slot, workspace_id, run_id):
    return file_response(request, workbench.run_file(run_id, query_value(request, "path", required=True)))


@controller(name="compare", url="w/{portal_id}/{slot}/{workspace_id}/api/runs/{run_id}/compare", login_required=False)
@endpoint()
def compare(request, workbench, context, portal_id, slot, workspace_id, run_id):
    return json_response(workbench.compare(
        run_id, query_value(request, "baseline_run_id", required=True, maximum=128),
    ))


@controller(name="report", url="w/{portal_id}/{slot}/{workspace_id}/api/reports/{report_id}", login_required=False)
@endpoint()
def report(request, workbench, context, portal_id, slot, workspace_id, report_id):
    return json_response(workbench.report_detail(report_id))


@controller(name="report_export", url="w/{portal_id}/{slot}/{workspace_id}/api/reports/{report_id}/export", login_required=False)
@endpoint()
def report_export(request, workbench, context, portal_id, slot, workspace_id, report_id):
    format_name = query_value(request, "format", required=True, maximum=8)
    if format_name not in ("zip", "json", "html", "csv"):
        raise PortalProblem("portal_export_format_invalid", "Choose zip, json, html or csv.")
    return file_response(request, workbench.report_export(report_id, format_name))


@controller(name="backup", url="w/{portal_id}/{slot}/{workspace_id}/api/backups/{backup_id}/download", login_required=False)
@endpoint()
def backup(request, workbench, context, portal_id, slot, workspace_id, backup_id):
    require_permission(request, "backup_workspace")
    return file_response(request, workbench.backup_file(backup_id))


@controller(name="portal_information", url="w/{portal_id}/{slot}/{workspace_id}/api/portal", login_required=False)
@endpoint()
def portal_information(request, workbench, context, portal_id, slot, workspace_id):
    try:
        portal_version = importlib.metadata.version("tethys-platform")
    except importlib.metadata.PackageNotFoundError:
        portal_version = None
    return json_response({
        "schema": "groundwater.tethys-installation.v1",
        "portal_version": portal_version,
        "supported_portal_version": "4.6.1",
        "actor": request.user.get_username(),
        "permissions": permissions_for(request),
        "paths": context.as_dict(),
        "workspace": workbench.state()["workspace"],
        "native_runtime": workbench.runtime(),
        "native_execution_owner": "groundwater_workspace",
    })


@controller(name="action", url="w/{portal_id}/{slot}/{workspace_id}/api/action", login_required=False)
@endpoint(methods=("POST",))
def action(request, workbench, context, portal_id, slot, workspace_id):
    original = read_json(request, configuration()["max_request_bytes"])
    action_name = original.get("action")
    if not isinstance(action_name, str) or action_name not in ACTION_PERMISSIONS:
        raise PortalProblem("portal_action_not_supported", "This portal does not expose that action.")
    require_permission(request, ACTION_PERMISSIONS[action_name])
    payload = original.get("payload")
    if not isinstance(payload, dict):
        raise PortalProblem("portal_payload_invalid", "The original action payload must be an object.")
    check_receiver_action(workbench, context, action_name, payload)
    # The authenticated account is the actual actor. The core retains its exact
    # operation ID, payload, version check and original response; no portal journal.
    forwarded = dict(original)
    forwarded["actor"] = request.user.get_username()
    return json_response(workbench.dispatch(forwarded))

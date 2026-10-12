"""Portal identity, private Paths and original-workspace binding.

No database, operation journal, native queue or active-slot pointer is created here.
A slot is an explicit URL/CLI selection under this app's existing Tethys Paths root.
"""
from dataclasses import dataclass
import os
import hashlib
import json
from pathlib import Path
import re
import stat

from django.conf import settings
from tethys_sdk.permissions import has_permission

from .app import App

DEFAULT_CONFIG = {
    "workspace_scope": "user",
    "default_slot": "workspace",
    "max_request_bytes": 33554432,
}
SLOT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
WORKSPACE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
PERMISSIONS = (
    "view_workspace", "edit_workspace", "review_workspace", "execute_runs",
    "configure_runtime", "publish_reports", "receive_reports", "backup_workspace",
    "use_shared_workspace",
)
ACTION_PERMISSIONS = {
    "project.create": "edit_workspace",
    "project.update": "edit_workspace",
    "source.publisher": "edit_workspace",
    "source.import": "edit_workspace",
    "edition.create": "edit_workspace",
    "edition.review": "review_workspace",
    "runtime.configure": "configure_runtime",
    "run.create": "execute_runs",
    "run.execute": "execute_runs",
    "run.resume": "execute_runs",
    "run.review": "review_workspace",
    "report.freeze": "publish_reports",
    "receiver.save": "receive_reports",
    "report.deliver": "receive_reports",
    "delivery.resume": "receive_reports",
    "delivery.reconcile": "receive_reports",
    "delivery.acknowledge": "receive_reports",
    "backup.create": "backup_workspace",
    "backup.resume": "backup_workspace",
}


class PortalProblem(Exception):
    def __init__(self, code, message, status=400, **detail):
        super().__init__(message)
        self.code, self.message, self.status, self.detail = code, message, status, detail

    def as_dict(self):
        return {"code": self.code, "message": self.message, **self.detail}


def require_user(request):
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated or not user.is_active:
        raise PortalProblem(
            "portal_authentication_required",
            "Sign in to the existing Tethys account before opening this private workspace.",
            401,
        )
    return user


def require_permission(request, name):
    require_user(request)
    if not has_permission(request, name):
        raise PortalProblem(
            "portal_permission_required",
            "The Tethys account does not have the required application permission.",
            403, permission=name,
        )


def permissions_for(request):
    require_user(request)
    return {name: bool(has_permission(request, name)) for name in PERMISSIONS}


def configuration():
    if getattr(settings, "USE_OLD_WORKSPACES_API", False):
        raise PortalProblem(
            "portal_paths_api_required",
            "This installation uses the current Tethys Paths API. Disable the legacy workspace API in the existing portal configuration.",
            503,
        )
    value = App.get_custom_setting("portal_configuration")
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise PortalProblem("portal_configuration_invalid", "portal_configuration must be a JSON object.", 503)
    unknown = sorted(set(value) - set(DEFAULT_CONFIG))
    if unknown:
        raise PortalProblem("portal_configuration_invalid", "Unsupported portal configuration keys.", 503, keys=unknown)
    config = {**DEFAULT_CONFIG, **value}
    if config["workspace_scope"] not in ("user", "app"):
        raise PortalProblem("portal_configuration_invalid", "workspace_scope must be user or app.", 503)
    validate_slot(config["default_slot"])
    size = config["max_request_bytes"]
    if type(size) is not int or not 1024 <= size <= 134217728:
        raise PortalProblem(
            "portal_configuration_invalid",
            "max_request_bytes must be an integer from 1024 through 134217728.",
            503,
        )
    return config


def validate_slot(value):
    if not isinstance(value, str) or not SLOT.fullmatch(value):
        raise PortalProblem(
            "portal_slot_invalid",
            "Choose a slot of 1–64 letters, digits, underscores or hyphens, starting with a letter or digit.",
        )
    return value


def private_directory(path, *, create=False):
    path = Path(path)
    if create:
        try:
            path.mkdir(mode=0o700)
        except FileExistsError:
            pass
    try:
        info = path.lstat()
    except FileNotFoundError:
        raise PortalProblem("portal_workspace_unavailable", "The selected private directory is unavailable.", 409)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise PortalProblem("portal_private_path_invalid", "A private directory must be an original directory, not a link or special file.", 409)
    if hasattr(os, "geteuid") and info.st_uid != os.geteuid():
        raise PortalProblem("portal_private_path_owner", "The selected private directory is not owned by the portal service account.", 409)
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise PortalProblem(
            "portal_private_path_permissions",
            "The selected private app directory must have mode 0700. Have the portal operator correct its existing permissions.",
            409,
        )
    return path


@dataclass(frozen=True)
class PortalContext:
    scope: str
    slot: str
    root: Path
    container: Path
    workspace: Path
    receiving: Path
    reports: Path

    def require_existing(self):
        private_directory(self.container)
        private_directory(self.workspace)
        database = self.workspace / "groundwater.sqlite"
        try:
            info = database.lstat()
        except FileNotFoundError:
            raise PortalProblem(
                "portal_bound_workspace_missing",
                "The original groundwater.sqlite is missing. Restore its existing backup before reopening this URL; a replacement workspace was not initialized.",
                409,
            )
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise PortalProblem("portal_database_invalid", "The original database is not a regular file.", 409)
        return self

    def prepare_new(self):
        if self.container.exists() or self.container.is_symlink():
            raise PortalProblem(
                "portal_slot_exists",
                "This slot already has retained material. Reopen it or choose a new empty slot.",
                409,
            )
        private_directory(self.container, create=True)
        private_directory(self.workspace, create=True)
        return self

    def receiver_directory(self, value):
        if not isinstance(value, str) or not value or len(value) > 4096:
            raise PortalProblem("portal_receiver_invalid", "Select an existing directory in this slot's private receiving root.")
        selected = Path(value)
        if not selected.is_absolute() or ".." in selected.parts:
            raise PortalProblem("portal_receiver_invalid", "The receiving directory must be an absolute path without parent traversal.")
        root = private_directory(self.receiving)
        try:
            relative = selected.relative_to(root)
        except ValueError:
            raise PortalProblem(
                "portal_receiver_outside_slot",
                "The portal can deliver only inside this selected slot's private receiving root.",
                403,
            )
        current = root
        for part in relative.parts:
            current = private_directory(current / part)
        return str(current)

    def as_dict(self):
        return {
            "scope": self.scope,
            "slot": self.slot,
            "restore_destination": str(self.container),
            "workspace": str(self.workspace),
            "receiving_directory": str(self.receiving),
            "received_reports_directory": str(self.reports),
            "database_present": (self.workspace / "groundwater.sqlite").is_file(),
        }


def context_for_user(user, slot, *, config=None, create_roots=False):
    config = config or configuration()
    validate_slot(slot)
    if not user.is_authenticated or not user.is_active:
        raise PortalProblem("portal_authentication_required", "The selected portal account must be active.", 401)
    # Public current Paths methods enforce the portal's app/user quota first.
    try:
        base = (
            App.get_app_workspace().path
            if config["workspace_scope"] == "app"
            else App.get_user_workspace(user).path
        )
    except AssertionError:
        raise PortalProblem(
            "portal_paths_quota",
            "The existing Tethys private workspace quota prevents this request.",
            409,
        )
    root = private_directory(Path(base) / "groundwater_workshare", create=create_roots)
    workspaces = private_directory(root / "workspaces", create=create_roots)
    receivers = private_directory(root / "receivers", create=create_roots)
    reports = private_directory(root / "received_reports", create=create_roots)
    receiving = private_directory(receivers / slot, create=create_roots)
    received_reports = private_directory(reports / slot, create=create_roots)
    container = workspaces / slot
    return PortalContext(
        config["workspace_scope"], slot, root, container, container / "workspace",
        receiving, received_reports,
    )


def context_for_request(request, slot, *, create_roots=False):
    user = require_user(request)
    config = configuration()
    if config["workspace_scope"] == "app":
        require_permission(request, "use_shared_workspace")
    return context_for_user(user, slot, config=config, create_roots=create_roots)


def portal_binding(context, user):
    """Nonsecret routing identity; separates account/scope/restore locations."""
    value = {
        "account": str(user.pk),
        "scope": context.scope,
        "root": str(context.root),
    }
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def require_portal_binding(context, user, expected):
    actual = portal_binding(context, user)
    if not isinstance(expected, str) or expected != actual:
        raise PortalProblem(
            "portal_principal_changed",
            "This address belongs to another signed-in account or private workspace location. Open the current slot from the application launcher.",
            409,
        )
    return actual


def bind_workspace(workbench, expected_id):
    if not isinstance(expected_id, str) or not WORKSPACE_ID.fullmatch(expected_id):
        raise PortalProblem("portal_workspace_id_invalid", "The workspace URL has an invalid identity.")
    identity = workbench.state()["workspace"]["id"]
    if identity != expected_id:
        raise PortalProblem(
            "portal_workspace_changed",
            "This URL belongs to a different original workspace. Open the selected slot again before making a new request.",
            409, expected_workspace_id=expected_id, current_workspace_id=identity,
        )
    return identity


def check_receiver_action(workbench, context, action, payload):
    if action == "receiver.save":
        # Preserve the supplied exact value; validation never rewrites a saved request.
        if context.receiver_directory(payload.get("directory")) != payload.get("directory"):
            raise PortalProblem("portal_receiver_invalid", "Use the receiving directory's exact canonical path.")
        return
    if action not in ("report.deliver", "delivery.resume", "delivery.reconcile", "delivery.acknowledge"):
        return
    state = workbench.state()
    receiver_id = payload.get("receiver_id")
    if action != "report.deliver":
        delivery = next((x for x in state["deliveries"] if x["id"] == payload.get("id")), None)
        if delivery is None:
            return  # The original core returns its authoritative missing-record result.
        receiver_id = delivery["receiver_id"]
    receiver = next((x for x in state["receivers"] if x["id"] == receiver_id), None)
    if receiver is not None:
        context.receiver_directory(receiver["directory"])

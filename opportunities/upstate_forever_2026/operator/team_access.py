"""Named team access for the existing local scientific operator.

Credentials are random capabilities, stored only as SHA-256 hashes. Scientific
workspaces and portable project archives never contain the installation registry.
"""
from __future__ import annotations
from collections import deque
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time

from model.common import atomic_json, canonical, now, read_json

CONTEXT = ContextVar("upstate_team_request", default=None)
ROLES = {"viewer": 1, "analyst": 2}
SCHEMA = "upstate.team-access/v1"

def secret_hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

class TeamAccess:
    def __init__(self, root, fault, workspace_ids):
        self.root, self.Fault = Path(root), fault
        self.workspace_ids = workspace_ids
        self.lock = threading.RLock()
        self.path = self.root / "team-access.json"
        self.resources_path = self.root / "team-resources.json"
        self.audit_path = self.root / "team-activity.jsonl"
        self.sessions = {}
        self.route_policy = read_json(Path(__file__).with_name("team_route_policy.json"))
        if self.path.exists():
            self.data = read_json(self.path)
            if self.data.get("schema") != SCHEMA:
                raise fault("TEAM_SCHEMA", "This installation uses an unsupported team registry.", 409)
        else:
            self.data = {"schema": SCHEMA, "installation_id": secrets.token_hex(16),
                         "revision": 0, "created_at": now(), "staff": {}}
            self._save(self.path, self.data)
        self.resources = read_json(self.resources_path) if self.resources_path.exists() else {}
        self.cookie_name = "upstate_file_" + self.data["installation_id"][:16]

    def _save(self, path, value):
        atomic_json(path, value)
        os.chmod(path, 0o600)

    def owner(self):
        return {"id": "local-owner", "display_name": "Local installation owner",
                "administrator": True, "projects": {}, "credential_version": 0, "local_owner": True}

    def public(self, row):
        return {k: v for k, v in row.items()
                if k not in {"credential_hash"}}

    def _principal(self, row):
        return {k: row[k] for k in
                ("id", "display_name", "administrator", "projects", "credential_version")}

    def authenticate(self, authorization, bootstrap, cookie_value=None):
        supplied = authorization[7:] if authorization.startswith("Bearer ") else ""
        if supplied and len(supplied) <= 256 and hmac.compare_digest(supplied.encode("utf-8"), bootstrap.encode("utf-8")):
            return self.owner()
        with self.lock:
            if supplied and len(supplied) <= 256:
                wanted = secret_hash(supplied)
                for row in self.data["staff"].values():
                    if row["active"] and hmac.compare_digest(wanted, row["credential_hash"]):
                        return self._principal(row)
            if cookie_value:
                session = self.sessions.get(secret_hash(cookie_value))
                if session and session["expires"] > time.time():
                    principal = session["principal"]
                    if principal.get("local_owner"):
                        return self.owner()
                    row = self.data["staff"].get(principal["id"])
                    if (row and row["active"] and
                            row["credential_version"] == principal["credential_version"]):
                        return self._principal(row)
        raise self.Fault("OPERATOR_TOKEN", "Open your current team access link to connect.", 401)

    def session(self, principal):
        value = secrets.token_urlsafe(36)
        with self.lock:
            current = time.time()
            self.sessions = {k: v for k, v in self.sessions.items() if v["expires"] > current}
            self.sessions[secret_hash(value)] = {"principal": principal, "expires": current + 8*3600}
        return value

    def logout(self, cookie_value):
        if cookie_value:
            with self.lock:
                self.sessions.pop(secret_hash(cookie_value), None)

    def role(self, principal, workspace):
        return "administrator" if principal["administrator"] else principal["projects"].get(workspace)

    def require(self, principal, workspace=None, *, write=False, administrator=False):
        if not principal:
            raise self.Fault("OPERATOR_TOKEN", "Connect with your current team access link.", 401)
        if principal["administrator"]:
            return
        if administrator:
            raise self.Fault("TEAM_ADMIN", "An installation administrator manages this operation.", 403)
        role = self.role(principal, workspace)
        if ROLES.get(role, 0) < (2 if write else 1):
            raise self.Fault("PROJECT_ACCESS", "Your current access does not allow this project operation.", 403)

    def current(self):
        return CONTEXT.get()

    @contextmanager
    def scope(self, principal, workspace=None):
        marker = CONTEXT.set({"principal": principal, "workspace": workspace})
        try:
            yield
        finally:
            CONTEXT.reset(marker)

    def set_request(self, principal, workspace=None):
        CONTEXT.set({"principal": principal, "workspace": workspace})

    def set_workspace(self, workspace):
        context = self.current()
        if context:
            CONTEXT.set({**context, "workspace": workspace})

    def check_workspace(self, workspace, *, write=False):
        context = self.current()
        if context:
            self.require(context["principal"], workspace, write=write)

    def workspaces(self, principal, rows):
        result = []
        for row in rows:
            role = self.role(principal, row["id"])
            if role:
                result.append({**row, "access_role": role})
        return result

    def default_workspace(self, principal, primary):
        if self.role(principal, primary):
            return primary
        return next((key for key in self.workspace_ids() if self.role(principal, key)), None)

    def actor(self, principal=None):
        context = self.current()
        principal = principal or (context and context["principal"])
        if principal:
            return {k: principal[k] for k in ("id", "display_name")}
        return None

    def task_principal(self, task):
        actor = task.get("execution_requested_by") or task.get("requested_by")
        if not actor or actor["id"] == "local-owner":
            return self.owner()
        with self.lock:
            row = self.data["staff"].get(actor["id"])
            if not row or not row["active"]:
                raise self.Fault("TASK_ACTOR_DISABLED", "The person who queued this task no longer has active access.", 403)
            principal = self._principal(row)
        self.require(principal, task["workspace"], write=True)
        return principal

    def grant_resource(self, kind, key, workspace):
        context = self.current()
        if not context or context["principal"]["administrator"]:
            # Keep resource provenance for named administrators too. A legacy
            # unscoped local import remains installation-owned.
            if not workspace:
                return
        if not workspace:
            raise self.Fault("PROJECT_REQUIRED", "Choose the project for this source.", 422)
        self.check_workspace(workspace, write=True)
        with self.lock:
            identity = kind + ":" + key
            existing = self.resources.get(identity, [])
            if workspace not in existing:
                self.resources[identity] = [*existing, workspace]
                self._save(self.resources_path, self.resources)

    def can_resource(self, kind, key):
        context = self.current()
        if not context or context["principal"]["administrator"]:
            return True
        workspace = context["workspace"]
        with self.lock:
            return bool(self.role(context["principal"], workspace) and
                        workspace in self.resources.get(kind + ":" + key, []))

    def check_resource(self, kind, key):
        context = self.current()
        if not context or context["principal"]["administrator"]:
            return
        workspace = context["workspace"]
        self.require(context["principal"], workspace)
        with self.lock:
            allowed = workspace in self.resources.get(kind + ":" + key, [])
        if not allowed:
            raise self.Fault("SOURCE_ACCESS", "Import this source into the selected project before using it.", 403)

    def viewer_post(self, path):
        return (path in self.route_policy["safeViewerPosts"] and
                path not in self.route_policy["writePosts"] and
                path not in self.route_policy["adminRoutes"])

    def require_route(self, path, method="GET"):
        context = self.current()
        if not context:
            return
        if path in self.route_policy["adminRoutes"]:
            self.require(context["principal"], administrator=True)
        if method.upper() == "POST" and not self.viewer_post(path):
            self.require(context["principal"], context["workspace"], write=True)

    def require_action(self, action, payload):
        context = self.current()
        if context and action in {"workspace.restore", "workspace.receive", "workspace.recovery.resume",
                                  "project.transfer.restore", "parcel.source.receive", "parcel.source.prepare"}:
            self.require(context["principal"], administrator=True)
        if context and action == "regional-soil.prepare" and payload.get("method") in {"regional-capture", "regional-continue"}:
            self.require(context["principal"], administrator=True)
        self.require_payload(payload)

    def require_payload(self, value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "upload_id" and isinstance(child, str):
                    self.check_resource("upload", child)
                elif key == "preview_id" and isinstance(child, str):
                    self.check_resource("preview", child)
                elif key in {"root_id", "source_root_id", "registered_id", "registered_ids"} and child:
                    context = self.current()
                    if context:
                        self.require(context["principal"], administrator=True)
                elif key in {"workspace", "workspace_key", "source_workspace", "target_workspace"} and isinstance(child, str):
                    self.check_workspace(child)
                else:
                    self.require_payload(child)
        elif isinstance(value, list):
            for child in value:
                self.require_payload(child)

    def record(self, event, *, principal=None, workspace=None, task_id=None, detail=None):
        row = {"at": now(), "event": event, "actor": self.actor(principal),
               "workspace": workspace, "task_id": task_id, "detail": detail or {}}
        with self.lock:
            descriptor = os.open(self.audit_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            with os.fdopen(descriptor, "ab") as out:
                out.write(canonical(row) + b"\n")
                out.flush()
                os.fsync(out.fileno())

    def state(self, principal, rows):
        self.require(principal, administrator=True)
        with self.lock:
            staff = [self.public(row) for row in self.data["staff"].values()]
            activity = []
            if self.audit_path.exists():
                with self.audit_path.open(encoding="utf-8") as stream:
                    activity = [json.loads(line) for line in deque(stream, maxlen=200)]
            return {"schema": SCHEMA, "revision": self.data["revision"],
                    "installation_id": self.data["installation_id"],
                    "staff": sorted(staff, key=lambda x: (not x["active"], x["display_name"].casefold())),
                    "workspaces": rows, "activity": list(reversed(activity))}

    def change(self, principal, value):
        self.require(principal, administrator=True)
        operation = value.get("operation")
        if operation not in {"create", "update", "rotate", "disable"}:
            raise self.Fault("TEAM_OPERATION", "Choose a supported team operation.", 422)
        with self.lock:
            if value.get("expected_revision") != self.data["revision"]:
                raise self.Fault("TEAM_CHANGED", "Team access changed. Refresh it before saving.", 409)
            staff = self.data["staff"]
            key = secrets.token_hex(16) if operation == "create" else value.get("id")
            current = staff.get(key)
            if operation != "create" and current is None:
                raise self.Fault("TEAM_PERSON", "Choose a current team member.", 404)
            if principal["id"] == key and operation in {"disable", "rotate"}:
                raise self.Fault("TEAM_SELF_ACCESS", "Use another administrator or local startup access to replace your own link.", 409)
            row = dict(current or {"id": key, "created_at": now(), "active": True, "credential_version": 0})
            if operation in {"create", "update"}:
                name = value.get("display_name")
                if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120 or any(ord(c) < 32 for c in name):
                    raise self.Fault("TEAM_NAME", "Enter a name of 1 to 120 characters.", 422)
                administrator = value.get("administrator")
                projects = value.get("projects")
                if not isinstance(administrator, bool) or not isinstance(projects, dict):
                    raise self.Fault("TEAM_PERMISSIONS", "Choose the administrator setting and explicit project access.", 422)
                available = set(self.workspace_ids())
                if any(key not in available or role not in ROLES for key, role in projects.items()):
                    raise self.Fault("TEAM_PROJECT", "Choose current projects with viewer or analyst access.", 422)
                if principal["id"] == key and not administrator:
                    raise self.Fault("TEAM_SELF_ACCESS", "Use another administrator to remove your own administrator access.", 409)
                if not administrator and not projects:
                    raise self.Fault("TEAM_PROJECT", "Assign at least one project, or disable this person's access.", 422)
                row.update(display_name=name.strip(), administrator=administrator, projects=dict(projects))
                # Permission changes invalidate all existing file sessions. The
                # same access link uses the newly saved grants on its next API request.
                row["credential_version"] += 1
            secret = None
            if operation in {"create", "rotate"}:
                secret = secrets.token_urlsafe(36)
                row.update(credential_hash=secret_hash(secret), active=True)
                row["credential_version"] += 1
            if operation == "disable":
                row.update(active=False, credential_version=row["credential_version"] + 1)
            row["updated_at"] = now()
            updated = {**self.data, "revision": self.data["revision"] + 1,
                       "staff": {**staff, key: row}}
            self._save(self.path, updated)
            self.data = updated
            # Remove revoked sessions now as well as validating their revision on use.
            self.sessions = {k: s for k, s in self.sessions.items()
                             if s["principal"]["id"] != key}
            self.record("team." + operation, principal=principal, detail={"staff_id": key})
            return {"revision": updated["revision"], "person": self.public(row), "access_token": secret}

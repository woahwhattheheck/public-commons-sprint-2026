"""Explicit additive registrations for the existing operator.

Installed JSON manifests bind trusted application modules to the original
HTTP handler, serial task queue, workspace state and verified file tickets.
No separate server, queue or download transport is introduced.
"""
from __future__ import annotations

from copy import deepcopy
import importlib
import json
import math
from pathlib import Path, PurePosixPath
import re
from typing import Any

SCHEMA = "upstate.operator-extension/v1"
_IDENTIFIER = re.compile(r"^[a-z][a-z0-9-]*$")
_MODULE = re.compile(r"^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$")
_MEMBER = re.compile(r"^[A-Za-z_]\w*$")
_CONTEXT_KEYS = frozenset({
    "operator", "fault", "source_roots", "workspace", "workspace_key",
    "operation", "action", "payload", "task",
})


class ExtensionRegistry:
    """Application-owned registration catalogue.

    Create after registered sources and original workspaces are initialized.
    Manifests live in the installed operator/extensions directory, never in a
    user-supplied scientific workspace.
    """

    def __init__(self, operator, fault, *, directory=None, builtin_actions=(),
                 builtin_kinds=(), builtin_routes=(), source_roots=()):
        self.operator = operator
        self.fault = fault
        self.directory = Path(directory or Path(__file__).parent / "extensions")
        self.source_roots = source_roots
        self._builtin_actions = set(builtin_actions)
        self._builtin_kinds = set(builtin_kinds)
        self._builtin_routes = set(builtin_routes)
        self._extensions = {}
        self._actions = {}
        self._routes = {}
        self._items = {}
        self._views = {}
        self._state_keys = {}
        self._assets = {"extension_host.mjs"}
        self._issues = {}

    def _fail(self, code, message, status=422):
        raise self.fault(code, message, status)

    @staticmethod
    def _asset(value):
        if not isinstance(value, str):
            raise ValueError("An asset must be a relative web path.")
        value = value.removeprefix("/web/")
        path = PurePosixPath(value)
        if (not value or value.startswith("/") or "\\" in value
                or any(part in {"", ".", ".."} for part in value.split("/"))
                or any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", part)
                       for part in path.parts)):
            raise ValueError("An asset must stay within the installed web directory.")
        if path.suffix not in {'.mjs', '.css', '.html'}:
            raise ValueError('Static assets must use the original operator HTML, module or CSS transport.')
        return value

    @staticmethod
    def _module(name):
        if not isinstance(name, str) or not _MODULE.fullmatch(name):
            raise ValueError("Choose an explicit installed Python module.")
        return importlib.import_module(name)

    def _issue(self, extension_id, stage, error):
        self._issues[(extension_id, stage)] = {
            "extension_id": extension_id, "stage": stage,
            "code": getattr(error, "code", type(error).__name__),
            "message": str(error),
        }

    def _clear_issue(self, extension_id, stage):
        self._issues.pop((extension_id, stage), None)

    def _context(self, *, workspace_key=None, payload=None, task=None,
                 operation=None, workspace=None):
        if task is not None:
            workspace_key = task.get("workspace", workspace_key)
            payload = task.get("payload", payload)
        if workspace is None and workspace_key is not None:
            workspace = self.operator.ws(workspace_key)
        return {
            "operator": self.operator, "fault": self.fault,
            "source_roots": self.source_roots,
            "workspace_key": workspace_key, "workspace": workspace,
            "operation": operation,
            "action": task.get("action") if task is not None else None,
            "payload": {} if payload is None else payload,
            "task": task,
        }

    def _binding(self, specification, provider):
        if not isinstance(specification, dict):
            raise ValueError("A binding must identify its handler and argument names.")
        target = self._module(specification["module"]) if specification.get("module") else provider
        member = specification.get("handler")
        if not isinstance(member, str) or not _MEMBER.fullmatch(member):
            raise ValueError("A handler must be one explicit module or provider member.")
        function = getattr(target, member)
        if not callable(function):
            raise ValueError("The registered handler is not callable.")
        arguments = specification.get("args", [])
        if not isinstance(arguments, list) or any(name not in _CONTEXT_KEYS for name in arguments):
            raise ValueError("A binding contains an unsupported context argument.")
        keywords = specification.get("kwargs", {})
        if (not isinstance(keywords, dict)
                or any(not _MEMBER.fullmatch(key) or name not in _CONTEXT_KEYS
                       for key, name in keywords.items())):
            raise ValueError("A binding contains an unsupported keyword argument.")
        return (function, tuple(arguments), dict(keywords))

    @staticmethod
    def _call(binding, context):
        function, arguments, keywords = binding
        return function(*(context[name] for name in arguments),
                        **{key: context[name] for key, name in keywords.items()})

    def load(self):
        """Read each explicit installed registration once; isolate failed desks."""
        if not self.directory.is_dir():
            return self
        for path in sorted(self.directory.glob("*.json")):
            extension_id = path.stem
            try:
                manifest = json.loads(path.read_text(encoding="utf-8"))
                extension_id = manifest.get("id", extension_id)
                self.register(manifest)
                self._clear_issue(extension_id, "registration")
            except Exception as error:
                self._issue(extension_id, "registration", error)
        return self

    def register(self, manifest):
        """Validate an entire registration before committing any of its routes."""
        if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
            raise ValueError("Unsupported extension manifest schema.")
        extension_id = manifest.get("id")
        if not isinstance(extension_id, str) or not _IDENTIFIER.fullmatch(extension_id):
            raise ValueError("An extension needs a stable lowercase id.")
        if extension_id in self._extensions:
            raise ValueError("Extension is already registered: " + extension_id)
        order = manifest.get("order", 100)
        if isinstance(order, bool) or not isinstance(order, (int, float)) or not math.isfinite(order):
            raise ValueError("Extension order must be a finite number.")
        assets = {self._asset(asset) for asset in manifest.get("assets", [])}
        missing_assets = [name for name in sorted(assets)
                          if not (Path(__file__).parent / "web" / name).is_file()]
        if missing_assets:
            raise ValueError("Installed extension assets are missing: " + ", ".join(missing_assets))
        backend = manifest.get("backend") or {}
        provider = self._module(backend["module"]) if backend.get("module") else None
        if backend.get("factory"):
            factory = dict(backend["factory"])
            factory.setdefault("handler", factory.pop("name", None))
            provider = self._call(self._binding(factory, provider), self._context())
        invoke = self._binding(backend["invoke"], provider) if backend.get("invoke") else None
        actions = set(backend.get("actions", []))
        if any(not isinstance(name, str) or not name for name in actions):
            raise ValueError("Action names must be nonempty strings.")
        if actions and invoke is None:
            raise ValueError("Registered actions require an invoke binding.")
        collisions = actions & (self._builtin_actions | self._actions.keys())
        if collisions:
            raise ValueError("Action registration collides with an existing owner: " + ", ".join(sorted(collisions)))
        requires = set(manifest.get("requires_actions", []))
        missing = requires - (self._builtin_actions | self._actions.keys() | actions)
        if missing:
            raise ValueError("Required original task actions are missing: " + ", ".join(sorted(missing)))

        routes = {}
        for route in backend.get("routes", []):
            path = route.get("path", "")
            if (not isinstance(path, str) or not path.startswith("/api/")
                    or "?" in path or "#" in path or "\\" in path
                    or any(part in {".", ".."} for part in path.split("/"))):
                raise ValueError("Read routes must have exact application /api/ paths.")
            operation = route.get("operation")
            binding = self._binding(route, provider)
            for method in route.get("methods", ["GET"]):
                key = (str(method).upper(), path)
                if key[0] not in {"GET", "POST"}:
                    raise ValueError("Extension reads support GET or POST through the original handler.")
                if key in routes or key in self._routes or key in self._builtin_routes:
                    raise ValueError("HTTP route registration collides: " + " ".join(key))
                routes[key] = (binding, operation)

        items = {}
        for item in backend.get("items", []):
            kind = item.get("kind", "")
            if not isinstance(kind, str) or not re.fullmatch(r"[a-z][a-z0-9_-]*", kind):
                raise ValueError("An item kind requires a stable identifier.")
            if kind in items or kind in self._items or kind in self._builtin_kinds:
                raise ValueError("Item kind registration collides: " + kind)
            items[kind] = (self._binding(item, provider), item.get("operation"))
        state = None
        if backend.get("state"):
            specification = backend["state"]
            key = specification.get("key", "")
            if (not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", key)
                    or key in self._state_keys or key in self._builtin_kinds):
                raise ValueError("State key is missing or already owned: " + str(key))
            state = (key, self._binding(specification, provider))
        decorate = self._binding(backend["decorate_task"], provider) if backend.get("decorate_task") else None
        verify = self._binding(backend["verify_workspace"], provider) if backend.get("verify_workspace") else None

        client = deepcopy(manifest.get("client") or {})
        if client:
            view = client.get("view") or {}
            view_id = view.get("id", "")
            if not isinstance(view_id, str) or not _IDENTIFIER.fullmatch(view_id):
                raise ValueError("A browser desk requires a stable view id.")
            if view_id in self._views:
                raise ValueError("Browser view registration collides: " + view_id)
            module = self._asset(client.get("module", ""))
            if module not in assets or not module.endswith(".mjs"):
                raise ValueError("The browser entry module must be an explicitly listed .mjs asset.")
            client["module"] = "/web/" + module
            if not _MEMBER.fullmatch(client.get("factory", "")):
                raise ValueError("The browser factory must be an explicit module export.")
            for style in client.get("styles", []):
                if self._asset(style) not in assets:
                    raise ValueError("Each stylesheet must be an explicitly listed asset.")

        entry = {
            "id": extension_id, "manifest": deepcopy(manifest), "provider": provider,
            "invoke": invoke, "actions": actions, "routes": routes, "items": items,
            "state": state, "decorate": decorate, "verify": verify, "client": client,
        }
        self._extensions[extension_id] = entry
        self._actions.update({name: entry for name in actions})
        self._routes.update({key: (entry, *value) for key, value in routes.items()})
        self._items.update({key: (entry, *value) for key, value in items.items()})
        if state:
            self._state_keys[state[0]] = entry
        if client:
            self._views[client["view"]["id"]] = entry
        self._assets.update(assets)
        return extension_id

    @property
    def accepted_actions(self):
        return frozenset(self._actions)

    @property
    def item_kinds(self):
        return frozenset(self._items)

    @property
    def web_assets(self):
        return frozenset(self._assets)

    def handles_action(self, action):
        return action in self._actions

    def has_route(self, method, path):
        return (method.upper(), path) in self._routes

    def has_item(self, kind):
        return kind in self._items

    def invoke(self, task):
        entry = self._actions.get(task.get("action"))
        if entry is None:
            self._fail("EXTENSION_ACTION", "This extension task action is not registered.", 404)
        return self._call(entry["invoke"], self._context(task=task))

    def read(self, method, path, workspace_key, payload=None):
        found = self._routes.get((method.upper(), path))
        if found is None:
            self._fail("EXTENSION_ROUTE", "This extension read route is not registered.", 404)
        entry, binding, operation = found
        return self._call(binding, self._context(workspace_key=workspace_key,
                                                operation=operation, payload=payload))

    def item(self, workspace_key, kind, key):
        found = self._items.get(kind)
        if found is None:
            self._fail("EXTENSION_ITEM", "This extension item kind is not registered.", 404)
        entry, binding, operation = found
        return self._call(binding, self._context(workspace_key=workspace_key,
                                                operation=operation, payload={"id": key, "view_id": key}))

    def extend_state(self, workspace_key, data):
        result = dict(data)
        context = self._context(workspace_key=workspace_key)
        for entry in self._extensions.values():
            if entry["state"] is None:
                continue
            key, binding = entry["state"]
            try:
                if key in result:
                    raise ValueError("Extension state would overwrite existing data: " + key)
                result[key] = self._call(binding, context)
                self._clear_issue(entry["id"], "state")
            except Exception as error:
                self._issue(entry["id"], "state", error)
        return result

    def decorate_task(self, task):
        entry = self._actions.get(task.get("action"))
        if entry is None or entry["decorate"] is None:
            return task
        value = deepcopy(task)
        try:
            decorated = self._call(entry["decorate"], self._context(task=value))
            if decorated is not None:
                if not isinstance(decorated, dict):
                    raise ValueError("Task decoration must return a task object or mutate its task argument.")
                value = decorated
            if isinstance(value.get("_downloads"), list):
                unique = {}
                for download in value["_downloads"]:
                    if not isinstance(download, dict):
                        continue
                    key = download.get("id") or download.get("url") or json.dumps(download, sort_keys=True)
                    unique.setdefault(key, download)
                value["_downloads"] = list(unique.values())
            self._clear_issue(entry["id"], "task")
            return value
        except Exception as error:
            self._issue(entry["id"], "task", error)
            value = deepcopy(task)
            value.setdefault("_extension_issues", []).append({
                "extension_id": entry["id"], "message": str(error),
            })
            return value

    def verify_workspace(self, workspace):
        """Run registered record verification inside the original restore flow."""
        context = self._context(workspace=workspace)
        results = {}
        for entry in self._extensions.values():
            if entry["verify"] is not None:
                results[entry["id"]] = self._call(entry["verify"], context)
        return results

    def manifest(self):
        entries = []
        for entry in self._extensions.values():
            manifest = entry["manifest"]
            entries.append({
                "id": entry["id"], "title": manifest.get("title", entry["id"]),
                "version": str(manifest.get("version", "1")),
                "order": manifest.get("order", 100),
                "client": deepcopy(entry["client"]),
                "actions": sorted(entry["actions"]),
                "reads": [{"method": method, "path": path}
                          for method, path in sorted(entry["routes"])],
                "state_key": entry["state"][0] if entry["state"] else None,
            })
        entries.sort(key=lambda entry: (entry["order"], entry["id"]))
        return {
            "schema": "upstate.operator-extensions/v1",
            "extensions": entries,
            "issues": list(self._issues.values()),
            "web_assets": sorted(self._assets),
        }

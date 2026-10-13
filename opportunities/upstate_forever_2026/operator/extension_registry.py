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
from urllib.parse import unquote

SCHEMA = "upstate.operator-extension/v1"
_IDENTIFIER = re.compile(r"^[a-z][a-z0-9-]*$")
_MODULE = re.compile(r"^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$")
_MEMBER = re.compile(r"^[A-Za-z_]\w*$")
_CONTEXT_KEYS = frozenset({
    "operator", "fault", "source_roots", "workspace", "workspace_key",
    "operation", "action", "payload", "task", "route_params", "principal",
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
        self._file_routes = []
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
                 operation=None, workspace=None, route_params=None):
        if task is not None:
            workspace_key = task.get("workspace", workspace_key)
            payload = task.get("payload", payload)
        if workspace is None and workspace_key is not None:
            workspace = self.operator.ws(workspace_key)
        team = getattr(self.operator, "team", None)
        request_context = team.current() if team else None
        principal = request_context["principal"] if request_context else None
        return {
            "principal": principal,
            "operator": self.operator, "fault": self.fault,
            "source_roots": self.source_roots,
            "workspace_key": workspace_key, "workspace": workspace,
            "operation": operation,
            "action": task.get("action") if task is not None else None,
            "payload": {} if payload is None else payload,
            "task": task, "route_params": route_params or {},
        }

    @staticmethod
    def _context_name(name):
        return isinstance(name, str) and (
            name in _CONTEXT_KEYS or re.fullmatch(r"route\.[A-Za-z_]\w*", name) is not None)

    @staticmethod
    def _context_value(name, context):
        if name.startswith("route."):
            return context["route_params"][name.removeprefix("route.")]
        return context[name]

    @staticmethod
    def _file_template(value):
        """Literal file families, opaque IDs and an optional final member path."""
        if (not isinstance(value, str) or not value.startswith("/api/file/")
                or "?" in value or "#" in value or "\\" in value):
            raise ValueError("A file route must use an explicit /api/file/ path.")
        parts = value.split("/")
        if len(parts) < 5 or not re.fullmatch(r"[a-z][a-z0-9-]*", parts[3]):
            raise ValueError("A preview route requires its own literal file family before ID parameters.")
        if parts[3] == "review-desk":
            raise ValueError("The original review-desk file family already has an owner.")
        names, members, pattern, shape = [], [], [], []
        for index, part in enumerate(parts):
            selected = re.fullmatch(r"\{([A-Za-z_]\w*)(\.\.\.)?\}", part)
            if selected:
                name, tail = selected.groups()
                if name in names:
                    raise ValueError("A file route repeats one parameter name.")
                names.append(name)
                if tail:
                    if index != len(parts) - 1 or name == "workspace_key":
                        raise ValueError("A relative member path must be the final file-route parameter.")
                    members.append(name)
                    pattern.append("(?P<" + name + ">[^?#]+)")
                    shape.append("**")
                else:
                    pattern.append("(?P<" + name + ">[A-Za-z0-9_-]+)")
                    shape.append(None)
            else:
                if part in {".", ".."} or (part and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", part)):
                    raise ValueError("File routes use literal segments and named source identifiers.")
                pattern.append(re.escape(part))
                shape.append(part)
        if parts[-1] == "" or not names:
            raise ValueError("A retained file route must declare its individual ID parameters.")
        return re.compile("^" + "/".join(pattern) + "$"), tuple(shape), tuple(names), tuple(members)

    @staticmethod
    def _overlap(left, right):
        for a, b in zip(left, right):
            if a == "**" or b == "**":
                return True
            if a is not None and b is not None and a != b:
                return False
        return len(left) == len(right)

    @staticmethod
    def _member_path(value):
        """Decode the URL once; the native provider still owns its exact inventory."""
        decoded = unquote(value, encoding="utf-8", errors="strict")
        if (not decoded or decoded.startswith("/") or "\\" in decoded
                or re.search(r"[\x00-\x1f\x7f]", decoded)
                or any(part in {"", ".", ".."} or ":" in part for part in decoded.split("/"))):
            raise ValueError("Choose a relative member from the original retained file inventory.")
        return decoded

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
        if not isinstance(arguments, list) or any(not self._context_name(name) for name in arguments):
            raise ValueError("A binding contains an unsupported context argument.")
        keywords = specification.get("kwargs", {})
        if (not isinstance(keywords, dict)
                or any(not _MEMBER.fullmatch(key) or not self._context_name(name)
                       for key, name in keywords.items())):
            raise ValueError("A binding contains an unsupported keyword argument.")
        return (function, tuple(arguments), dict(keywords))

    @staticmethod
    def _call(binding, context):
        function, arguments, keywords = binding
        return function(*(ExtensionRegistry._context_value(name, context) for name in arguments),
                        **{key: ExtensionRegistry._context_value(name, context) for key, name in keywords.items()})

    def load(self):
        """Compose installed providers by their declared action dependencies.

        File names control neither provider availability nor load success. A
        failed or cyclic dependency is attached to its actual component while
        all independently usable desks continue to register.
        """
        # Rebuild registration diagnostics from this installed-manifest pass.
        # Runtime task/state issues and every active provider stay untouched.
        for key in tuple(self._issues):
            if key[1] == "registration":
                self._issues.pop(key, None)
        if not self.directory.is_dir():
            return self
        candidates = []
        identity_paths = {}
        for path in sorted(self.directory.glob("*.json")):
            recognized_identity = None
            try:
                manifest = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
                    raise ValueError("Unsupported extension manifest schema.")
                extension_id = manifest.get("id")
                if not isinstance(extension_id, str) or not _IDENTIFIER.fullmatch(extension_id):
                    raise ValueError("An extension needs a stable lowercase id.")
                recognized_identity = extension_id
                identity_paths.setdefault(extension_id, []).append(path.name)
                required = manifest.get("requires_actions", [])
                backend = manifest.get("backend") or {}
                if not isinstance(backend, dict):
                    raise ValueError("The extension backend must be an object.")
                declared = backend.get("actions", [])
                for names, label in ((required, "Required actions"), (declared, "Actions")):
                    if (not isinstance(names, list)
                            or any(not isinstance(name, str) or not name for name in names)
                            or len(set(names)) != len(names)):
                        raise ValueError(label + " must be a list of unique nonempty names.")
                order = manifest.get("order", 100)
                if isinstance(order, bool) or not isinstance(order, (int, float)) or not math.isfinite(order):
                    raise ValueError("Extension order must be a finite number.")
                candidates.append({
                    "id": extension_id, "manifest": manifest, "path": path.name,
                    "required": set(required), "declared": set(declared), "order": order,
                })
            except Exception as error:
                key = recognized_identity or "file:" + path.name
                self._issue(key, "registration", error)

        for extension_id, paths in identity_paths.items():
            if len(paths) > 1:
                self._issue(extension_id, "registration", ValueError(
                    "Duplicate installed extension id in: " + ", ".join(paths)))
        pending = []
        for row in candidates:
            if len(identity_paths[row["id"]]) > 1:
                continue
            if row["id"] in self._extensions:
                installed = self._extensions[row["id"]]["manifest"]
                if installed == row["manifest"]:
                    self._clear_issue(row["id"], "registration")
                else:
                    self._issue(row["id"], "registration", ValueError(
                        "This installed extension changed after startup; reopen the operator to load its new source."))
            else:
                pending.append(row)

        pending.sort(key=lambda row: (row["order"], row["id"], row["path"]))
        while pending:
            progressed = False
            deferred = []
            for row in pending:
                available = self._builtin_actions | self._actions.keys() | row["declared"]
                if row["required"] - available:
                    deferred.append(row)
                    continue
                try:
                    self.register(row["manifest"])
                    self._clear_issue(row["id"], "registration")
                except Exception as error:
                    self._issue(row["id"], "registration", error)
                progressed = True
            if not deferred:
                break
            if progressed:
                pending = deferred
                continue
            providers = {}
            for row in deferred:
                for action in row["declared"]:
                    providers.setdefault(action, []).append(row["id"])
            for row in deferred:
                missing = sorted(row["required"] - (
                    self._builtin_actions | self._actions.keys() | row["declared"]))
                details = []
                for action in missing:
                    waiting = providers.get(action, [])
                    suffix = " (waiting on " + ", ".join(sorted(waiting)) + ")" if waiting else ""
                    details.append(action + suffix)
                self._issue(row["id"], "registration", ValueError(
                    "Required actions remain unavailable after loading installed providers: "
                    + ", ".join(details)
                    + ". Check the named provider's registration result or its dependency cycle."))
            break
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

        file_routes = []
        for route in backend.get("file_routes", []):
            path = route.get("path")
            pattern, shape, parameters, members = self._file_template(path)
            if route.get("response") != "ticket_policy_pair":
                raise ValueError("File routes must explicitly return the original ticket and policy pair.")
            for previous in [*self._file_routes, *file_routes]:
                if self._overlap(shape, previous["shape"]):
                    raise ValueError("File route registration overlaps an existing extension family: " + path)
            if ("GET", path) in self._builtin_routes or ("GET", path) in self._routes:
                raise ValueError("File route registration collides with an existing route: " + path)
            binding = self._binding(route, provider)
            names = [*binding[1], *binding[2].values()]
            if any(name.startswith("route.") and name.removeprefix("route.") not in parameters for name in names):
                raise ValueError("A file binding names a parameter absent from its route.")
            file_routes.append({"path": path, "pattern": pattern, "shape": shape,
                                "parameters": parameters, "member_parameters": members,
                                "binding": binding})

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
            "invoke": invoke, "actions": actions, "routes": routes, "file_routes": file_routes, "items": items,
            "state": state, "decorate": decorate, "verify": verify, "client": client,
        }
        self._extensions[extension_id] = entry
        self._actions.update({name: entry for name in actions})
        self._routes.update({key: (entry, *value) for key, value in routes.items()})
        self._file_routes.extend({**route, "entry": entry} for route in file_routes)
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

    def has_file_route(self, path):
        return any(route["pattern"].fullmatch(path) for route in self._file_routes)

    def file_reply(self, path):
        """Resolve an authenticated preview to the original verified file transport.

        The HTTP handler must authorize(file=True) before calling this method.
        """
        for route in self._file_routes:
            matched = route["pattern"].fullmatch(path)
            if not matched:
                continue
            parameters = matched.groupdict()
            for name in route["member_parameters"]:
                parameters[name] = self._member_path(parameters[name])
            context = self._context(workspace_key=parameters.get("workspace_key"),
                                    route_params=parameters)
            result = self._call(route["binding"], context)
            if not isinstance(result, (tuple, list)) or len(result) != 2:
                self._fail("EXTENSION_FILE", "The retained preview must return its file ticket and content policy.", 500)
            ticket, policy = result
            if not isinstance(ticket, dict) or not isinstance(ticket.get("id"), str) or not re.fullmatch(r"[0-9a-f]{64}", ticket["id"]):
                self._fail("EXTENSION_FILE", "The retained preview did not return an original operator file ticket.", 500)
            if policy is not None and (not isinstance(policy, str) or "\r" in policy or "\n" in policy):
                self._fail("EXTENSION_POLICY", "The retained preview returned an invalid content policy.", 500)
            workspace_key = parameters.get("workspace_key")
            if workspace_key is not None and ticket.get("workspace") != workspace_key:
                self._fail("EXTENSION_FILE_SCOPE", "The preview ticket belongs to another workspace.", 409)
            return {"ticket_id": ticket["id"], "content_security_policy": policy}
        self._fail("EXTENSION_FILE_ROUTE", "This retained preview route is not registered.", 404)

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
        team = getattr(self.operator, "team", None)
        if team:
            team.require_route(path, method)
            team.require_payload(payload)
        result = self._call(binding, self._context(workspace_key=workspace_key,
                                                  operation=operation, payload=payload))
        context = team.current() if team else None
        if (context and not context["principal"]["administrator"] and isinstance(result, dict)
                and path in {"/api/parcel-sources/catalog", "/api/published-studies/catalog"}):
            result = {**result, ("source_roots" if path == "/api/published-studies/catalog" else "roots"): []}
        return result

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
                "file_routes": [{"method": "GET", "path": route["path"], "response": "file"}
                                for route in entry["file_routes"]],
            })
        entries.sort(key=lambda entry: (entry["order"], entry["id"]))
        return {
            "schema": "upstate.operator-extensions/v1",
            "extensions": entries,
            "issues": list(self._issues.values()) if not getattr(self.operator, "team", None) or not self.operator.team.current() or self.operator.team.current()["principal"]["administrator"] else [],
            "web_assets": sorted(self._assets),
        }

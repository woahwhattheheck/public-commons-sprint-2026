#!/usr/bin/env python3
"""Compose explicit extension hooks into the current complete operator.

Run against the receiving application, with this additive package as source.
All current shared-file transformations are prepared and parsed before writing.
Existing desk modules and existing programmes/reviews/spatial joins are retained.
"""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

FILES = (
    "operator/extension_registry.py",
    "operator/web/extension_host.mjs",
    "operator/web/extension_host.check.mjs",
    "operator/extensions/source-preparation.json",
    "operator/extensions/native-run-desk.json",
    "operator/EXTENSIONS.md",
)
OPTIONAL_FILES = ("operator/extensions/decisions.json",)
BASE_ROUTES = (
    ("GET", "/api/extensions"), ("GET", "/api/state"), ("GET", "/api/item"),
    ("GET", "/api/source-info"), ("GET", "/api/task"), ("GET", "/api/run-log"),
    ("GET", "/api/runtime"), ("POST", "/api/upload"), ("POST", "/api/session"),
    ("POST", "/api/source-preview"), ("POST", "/api/actions"),
    ("POST", "/api/task/resume"), ("POST", "/api/task/cancel"),
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def replace(source, old, new, label):
    if new in source:
        return source
    count = source.count(old)
    if count != 1:
        raise ValueError(label + ": expected one current compatible anchor; found " + str(count))
    return source.replace(old, new, 1)


def add(source, anchor, addition, label, *, before=False):
    if addition in source:
        return source
    return replace(source, anchor, addition + anchor if before else anchor + addition, label)


def method(source, owner, name, transform):
    module = ast.parse(source)
    classes = [node for node in module.body if isinstance(node, ast.ClassDef) and node.name == owner]
    if len(classes) != 1:
        raise ValueError("Expected the original " + owner + " class")
    matches = [node for node in classes[0].body
               if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name]
    if len(matches) != 1:
        raise ValueError("Expected one current " + owner + "." + name + " method")
    node = matches[0]
    lines = source.splitlines(keepends=True)
    section = "".join(lines[node.lineno - 1:node.end_lineno])
    updated = transform(section)
    return "".join(lines[:node.lineno - 1]) + updated + "".join(lines[node.end_lineno:])


def patch_server(source):
    source = add(source, "from model.spatial_exports import SpatialExports\n",
                 "from extension_registry import ExtensionRegistry\n", "extension import")
    source = replace(source, "source_manifests=(), restore_directory=None,",
                     "source_manifests=(), source_roots=(), restore_directory=None,",
                     "registered source-root constructor")
    source = replace(source, "source_manifests=(), port=0, restore_directory=None,",
                     "source_manifests=(), source_roots=(), port=0, restore_directory=None,",
                     "registered source-root server")
    source = replace(source, "create=create, title=title, source_manifests=source_manifests,\n",
                     "create=create, title=title, source_manifests=source_manifests, source_roots=source_roots,\n",
                     "source-root constructor forwarding")
    source = add(source, '    parser.add_argument("--source-manifest", action="append", default=[])\n',
                 '    parser.add_argument("--source-root", action="append", default=[], help="Original source directory available to registered preparation desks")\n',
                 "source-root CLI")
    source = replace(source, "title=args.title, source_manifests=args.source_manifest, port=args.port,\n",
                     "title=args.title, source_manifests=args.source_manifest, source_roots=args.source_root, port=args.port,\n",
                     "source-root CLI forwarding")
    registration = (
        "        self.extensions = ExtensionRegistry(self, Fault,\n"
        "            builtin_actions=ACTIONS, builtin_kinds=KINDS,\n"
        "            builtin_routes=" + repr(BASE_ROUTES) + ",\n"
        "            source_roots=source_roots).load()\n"
    )
    source = add(source, '        for path in (self.root / "tasks").glob("*.json"):\n',
                 registration, "installed extension initialization", before=True)
    source = method(source, "Operator", "submit", lambda section: replace(
        section, "if action not in ACTIONS or not isinstance(payload, dict):",
        "if (action not in ACTIONS and not self.extensions.handles_action(action)) or not isinstance(payload, dict):",
        "existing queue admission"))
    source = method(source, "Operator", "_invoke", lambda section: add(
        section, '        action = task["action"]\n',
        "        if self.extensions.handles_action(action):\n            return self.extensions.invoke(task)\n",
        "existing worker extension dispatch"))
    source = method(source, "Operator", "state", lambda section: add(
        section, "        state = ws.overview()\n",
        "        state = self.extensions.extend_state(workspace, state)\n", "additive workspace state"))
    source = method(source, "Operator", "item", lambda section: add(
        section, "        if kind not in KINDS:\n",
        "        if self.extensions.has_item(kind):\n            return self.extensions.item(workspace, kind, key)\n",
        "retained extension items", before=True))

    def task_view(section):
        if "return self.extensions.decorate_task(" in section:
            return section
        lines = section.splitlines(keepends=True)
        positions = [index for index, line in enumerate(lines) if line.startswith("        return ")]
        if len(positions) != 1:
            raise ValueError("Task decoration requires the current single final return")
        index = positions[0]
        expression = lines[index].strip().removeprefix("return ")
        lines[index] = "        return self.extensions.decorate_task(" + expression + ")\n"
        return "".join(lines)

    source = method(source, "Operator", "task_view", task_view)
    source = method(source, "Operator", "_invoke", lambda section: replace(
        section, '            result["workspace_key"] = self.register(Workspace(result["workspace"]), received={\n',
        '            restored_workspace = Workspace(result["workspace"])\n'
        '            self.extensions.verify_workspace(restored_workspace)\n'
        '            result["workspace_key"] = self.register(restored_workspace, received={\n',
        "receiving verification before workspace registration"))

    def get_routes(section):
        section = add(section, '                workspace = one("workspace", self.app.primary)\n',
                      '                if url.path == "/api/extensions":\n'
                      '                    return self.send_json(200, self.app.extensions.manifest())\n',
                      "authenticated extension catalogue")
        section = add(section, '                raise Fault("ROUTE_MISSING", "This operator route does not exist.", 404)\n',
                      '                if self.app.extensions.has_route("GET", url.path):\n'
                      '                    return self.send_json(200, self.app.extensions.read("GET", url.path, workspace,\n'
                      '                        {name: values[0] for name, values in query.items()}))\n',
                      "authenticated extension GET", before=True)
        if "self.app.extensions.web_assets" not in section:
            matches = list(re.finditer(r"if selected not in (\{[^}\n]+\}):", section))
            if len(matches) != 1:
                raise ValueError("Expected the current explicit static asset allowlist")
            match = matches[0]
            original = ast.literal_eval(match.group(1))
            if not isinstance(original, set) or not all(isinstance(item, str) for item in original):
                raise ValueError("Static assets must preserve their original explicit names")
            replacement = "if selected not in (" + match.group(1) + " | self.app.extensions.web_assets):"
            section = section[:match.start()] + replacement + section[match.end():]
        return section

    source = method(source, "Handler", "do_GET", get_routes)
    source = method(source, "Handler", "do_POST", lambda section: add(
        section, '            raise Fault("ROUTE_MISSING", "This operator action does not exist.", 404)\n',
        '            if self.app.extensions.has_route("POST", url.path):\n'
        '                return self.send_json(200, self.app.extensions.read("POST", url.path,\n'
        '                    value.get("workspace", self.app.primary), value))\n',
        "authenticated extension POST", before=True))
    ast.parse(source, filename="operator/server.py")
    return source


def patch_app(source):
    source = add(source, "import {attachCustomerReviews} from './reviews.mjs';\n",
                 "import {createExtensionHost} from './extension_host.mjs';\n",
                 "extension browser import")
    registration = (
        "const extensions=createExtensionHost({getState:()=>state,getWorkspace:()=>workspace,api,endpoint,toast,\n"
        " navigationRoot:'.sidebar',refreshState:refresh,openItem,showTask,showRunLog,navigate,\n"
        " openForm,submitAction,detail,fileList,uploadFile,\n"
        " closeDetail:()=>{detailDialog.close();detailContext=null;},\n"
        " openDelivery:selection=>deliveryForm(undefined,selection),\n"
        " openProgramme:selection=>typeof programmes!=='undefined'?programmes.create({selection}):extensions.openExtension('programmes','create',{selection})});\n"
    )
    source = add(source, "function toast(message){", registration, "extension browser instance", before=True)
    source = add(source, "    renderTasks();\n", "    extensions.update(state);\n",
                 "all task refreshes reach active desks")
    render_anchor = "  if(view==='spatial'){"
    render_join = (
        "  if(extensions.render(view,$('#content'),state)){"
        "community.detach();customerReviews.detach();spatialWorkspace.suspend();"
        "if(typeof programmes!=='undefined')programmes.detach();return;}\n"
    )
    source = add(source, render_anchor, render_join, "extension view dispatch", before=True)
    source = replace(source, " if(!viewLabels[next])return;",
                     " if(!viewLabels[next]&&!extensions.hasView(next))return;",
                     "registered view navigation")
    source = replace(source, "if(viewLabels[requested])navigate(requested);",
                     "if(viewLabels[requested]||extensions.hasView(requested))navigate(requested);",
                     "registered fragment navigation")
    # Migrate the initial host join without changing the existing draft guard.
    source = source.replace("async function selectWorkspace(id){\n extensions.detach();\n",
                            "async function selectWorkspace(id){\n", 1)
    source = add(source,
                 " if(formDialog.open)throw Error('Finish or close the current draft before changing workspaces.');\n",
                 " extensions.detach();\n", "workspace lifecycle after original draft guard")
    source = add(source, " const action=button.dataset.action,id=button.dataset.id;\n",
                 " if(await extensions.dispatch(button))return;\n", "registered action dispatch")
    startup = (
        "try{await extensions.load();const requested=location.hash.slice(1);"
        "if(extensions.hasView(requested))view=requested;}"
        "catch(error){toast('Additional desks: '+error.message);}"
    )
    source = replace(source, "await api('/api/session',{method:'POST',body:{}});await refresh({force:true});",
                     "await api('/api/session',{method:'POST',body:{}});" + startup + "await refresh({force:true});",
                     "authenticated desk startup")

    # The native-run desk passes a retained selection to the original delivery
    # form. This is the existing form, with an optional initial selection.
    source = replace(source, "async function deliveryForm(id){",
                     "async function deliveryForm(id,initialSelection){", "native delivery selection")
    source = replace(source,
        "requireSources();const saved=id?await api(endpoint('/api/item',{kind:'deliveries',id})):null,row=saved?.selection;",
        "requireSources();const saved=id?await api(endpoint('/api/item',{kind:'deliveries',id})):null,row=saved?.selection||initialSelection;",
        "native delivery selection defaults")
    return source


def run(application, source_root, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    source_root = Path(source_root).resolve(strict=True)
    for name in ("model/workspace.py", "operator/server.py", "operator/web/app.mjs"):
        if not (application / name).is_file():
            raise ValueError("Receive the current complete application first; missing " + name)
    lock_root = application / ".locks"
    lock_root.mkdir(exist_ok=True)
    with (lock_root / "extension-install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pending, original = {}, {}
        names = list(FILES) + [name for name in OPTIONAL_FILES if (source_root / name).is_file()]
        for name in names:
            data = (source_root / name).read_bytes()
            if name.endswith(".py"):
                ast.parse(data.decode("utf-8"), filename=name)
            if name.endswith(".json"):
                value = json.loads(data)
                if value.get("schema") != "upstate.operator-extension/v1":
                    raise ValueError("Unexpected installed extension schema: " + name)
            target = application / name
            before = target.read_bytes() if target.exists() else None
            if before is not None and before != data:
                # Preserve an identical JSON registration despite whitespace.
                equal_json = name.endswith(".json") and json.loads(before) == json.loads(data)
                if not equal_json:
                    raise ValueError("Current authored extension source differs: " + name +
                                     ". Reconcile that source edition before replacing it.")
                data = before
            original[name], pending[name] = before, data
        for name, patch in (("operator/server.py", patch_server), ("operator/web/app.mjs", patch_app)):
            before = (application / name).read_bytes()
            original[name] = before
            pending[name] = patch(before.decode("utf-8")).encode("utf-8")
        changed = [name for name, data in pending.items() if original[name] != data]
        receipt = {
            "schema": "upstate.extension-install/v1",
            "application": str(application), "dry_run": dry_run,
            "changed": changed, "catalogue": "/api/extensions",
            "files": [{"path": name, "bytes": len(data), "sha256": sha(data),
                       "previous_sha256": sha(original[name]) if original[name] is not None else None}
                      for name, data in sorted(pending.items())],
        }
        if dry_run:
            return receipt
        with tempfile.TemporaryDirectory(prefix=".upstate-extensions-", dir=application.parent) as temporary:
            staging = Path(temporary)
            for name in changed:
                target = staging / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(pending[name])
            # Validate every current input before any replacement.
            for name in changed:
                target = application / name
                current = target.read_bytes() if target.exists() else None
                if current != original[name]:
                    raise RuntimeError("Concurrent authored changes preserved at " + name)
            for name in changed:
                target = application / name
                current = target.read_bytes() if target.exists() else None
                if current != original[name]:
                    raise RuntimeError("Concurrent authored changes preserved at " + name +
                                       "; rerun to compose remaining hooks from current source.")
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging / name, target)
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, help="Receiving complete application")
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(run(args.application, args.source_root, dry_run=args.dry_run), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

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
PREVIOUS_EDITIONS = {"operator/extension_registry.py":["9363ac944ff29b0fa86747a2c10e83f45dc7ed8a745343652b197010028d6147","ae573df9f2ad99307f34b8638ffe430b215670caecf6ad8bd669859918acfe5e"],"operator/EXTENSIONS.md":["a321eb9d8066e057a87b307c1c800914e71620915a20843dc1e5a07da37ddc67","966adc778953dbf3a91f9bb80fe3d989b935c2c0da3eade48fbf7a555280dea0"],"operator/extensions/native-run-desk.json":["cde106b0e8178721c81e3e8db6746b620bf32ad69c66f9811fde602c8e72e9f6"],"operator/extensions/source-preparation.json":["7706d871baa05a4eb819e4b82de9fb0b564206b11fa4638d54c90796622fb3ae"],"operator/web/extension_host.mjs":["43aa37111364d21bff403cd62338a67340ee343d57b02e8047c851f9007a547b"],"operator/extensions/decisions.json":["ce48c74bf0d7a4dc2577dc037d36aee4810729a5c8ab9a4ab5a720b94e85b691"]}
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


def registry_initialization(source, registration):
    """Retain one original registry and its complete current route set."""
    parsed = ast.parse(source)
    owners = [node for node in parsed.body
              if isinstance(node, ast.ClassDef) and node.name == "Operator"]
    initializers = [node for owner in owners for node in owner.body
                    if isinstance(node, ast.FunctionDef) and node.name == "__init__"]
    if len(owners) != 1 or len(initializers) != 1:
        raise ValueError("Preserve the original Operator.__init__ registry owner")
    assignments = [
        node for node in ast.walk(initializers[0])
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Attribute) and target.attr == "extensions"
            and isinstance(target.value, ast.Name) and target.value.id == "self"
            for target in node.targets)
    ]
    if not assignments:
        return add(source, '        for path in (self.root / "tasks").glob("*.json"):\n',
                   registration, "installed extension initialization", before=True)
    if len(assignments) != 1:
        raise ValueError("Preserve one current extension registry initialization")
    node = assignments[0]
    loaded = node.value
    factory = (loaded.func.value
               if isinstance(loaded, ast.Call)
               and isinstance(loaded.func, ast.Attribute)
               and loaded.func.attr == "load" else None)
    if (not isinstance(factory, ast.Call) or not isinstance(factory.func, ast.Name)
            or factory.func.id != "ExtensionRegistry" or loaded.args or loaded.keywords):
        raise ValueError("Compose the maintained ExtensionRegistry(...).load() initialization")
    keywords = {item.arg: item for item in factory.keywords}
    if None in keywords or len(keywords) != len(factory.keywords):
        raise ValueError("Preserve explicit original extension registry arguments")
    for name, original in (("builtin_actions", "ACTIONS"), ("builtin_kinds", "KINDS")):
        value = keywords.get(name)
        if value is None or not isinstance(value.value, ast.Name) or value.value.id != original:
            raise ValueError("Preserve the original registry " + name)
    if "builtin_routes" not in keywords:
        raise ValueError("Preserve the explicit original builtin route inventory")
    routes = ast.literal_eval(keywords["builtin_routes"].value)
    if (not isinstance(routes, (list, tuple)) or any(
            not isinstance(row, (list, tuple)) or len(row) != 2
            or not all(isinstance(value, str) for value in row) for row in routes)):
        raise ValueError("Preserve the original builtin method/path pairs")
    missing = [row for row in BASE_ROUTES if row not in [tuple(value) for value in routes]]
    changed = False
    if missing:
        keywords["builtin_routes"].value = ast.parse(repr(tuple(tuple(row) for row in routes) + tuple(missing)),
                                                    mode="eval").body
        changed = True
    if "source_roots" not in keywords:
        factory.keywords.append(ast.keyword(arg="source_roots", value=ast.Name(id="source_roots", ctx=ast.Load())))
        changed = True
    elif (not isinstance(keywords["source_roots"].value, ast.Name)
          or keywords["source_roots"].value.id != "source_roots"):
        raise ValueError("Preserve current registered source-root forwarding")
    if not changed:
        return source
    lines = source.splitlines(keepends=True)
    lines[node.lineno - 1:node.end_lineno] = [" " * node.col_offset + ast.unparse(node) + "\n"]
    return "".join(lines)


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
    source = registry_initialization(source, registration)
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
        if "self.extensions.decorate_task(" in section:
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
        section = add(section, '            if url.path.startswith("/api/file/"):\n',
                      '            if self.app.extensions.has_file_route(url.path):\n'
                      '                self.authorized(file=True)\n'
                      '                reply = self.app.extensions.file_reply(url.path)\n'
                      '                return self.send_file(reply["ticket_id"], download=one("download") == "1",\n'
                      '                                      content_security_policy=reply["content_security_policy"])\n',
                      "original authenticated retained-file transport", before=True)
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


def patch_view_lifecycle(source):
    """Run shared cleanup before any desk's original early-return render join."""
    entry = "function render(){\n  if(!state)return;\n"
    cleanup = (
        "  if(!extensions.hasView(view))extensions.detach();\n"
        "  if(typeof experiments!=='undefined'&&view!=='experiments')experiments.detach();\n"
        "  if(typeof experimentDiagnostics!=='undefined'&&view!=='experiment-diagnostics')experimentDiagnostics.detach();\n"
    )
    source = add(source, entry, cleanup, "shared desk cleanup at render entry")
    receiving_cleanup = (
        "  if(typeof receivingWaters!=='undefined'&&view!=='receiving-waters')receivingWaters.detach();\n"
    )
    source = add(source, entry + cleanup, receiving_cleanup,
                 "receiving-water desk cleanup before early returns")
    previous = (
        "  if(extensions.render(view,$('#content'),state)){"
        "community.detach();customerReviews.detach();spatialWorkspace.suspend();"
        "if(typeof programmes!=='undefined')programmes.detach();return;}\n"
    )
    dispatch = (
        "  if(extensions.render(view,$('#content'),state)){"
        "community.detach();customerReviews.detach();spatialWorkspace.suspend();"
        "if(typeof programmes!=='undefined')programmes.detach();"
        "if(typeof conservation!=='undefined')conservation.detach();return;}\n"
    )
    # A later desk installer can place an early return immediately after the
    # global navigation loop. Move our exact join back to that loop on rerun.
    # The render-entry detach also covers that install order before rerunning.
    for join in (previous, dispatch):
        if source.count(join) > 1:
            raise ValueError("Ambiguous installed extension view dispatch")
        source = source.replace(join, "", 1)
    if "if(extensions.render(view,$('#content'),state))" in source:
        raise ValueError("Compose the current authored extension view dispatch")
    # Current registered desks own a complete branch with additional native
    # controller cleanup. Preserve that branch rather than preceding it with
    # the earlier dispatch and a different cleanup set.
    native_dispatch = re.findall(
        r"(?ms)^  if\(extensions\.hasView\(view\)\)\{\n.*?"
        r"^    extensions\.render\(view,\$\('#content'\),state\);return;\n  \}",
        source)
    if native_dispatch:
        if len(native_dispatch) != 1:
            raise ValueError("Preserve one complete registered desk dispatch")
        return source
    # Include the line boundary: Conservation has its own four-space loop.
    navigation = (
        "\n  for(const node of $$('[data-view]'))"
        "node.setAttribute('aria-current',node.dataset.view===view?'page':'false');\n"
    )
    legacy_navigation = navigation.replace("$$(", "$(")
    if navigation not in source:
        source = replace(source, legacy_navigation, navigation,
                         "global navigation collection")
    return add(source, navigation, dispatch,
               "registered dispatch before built-in early-return desks")


def host_capabilities(registration):
    """Read the explicit host's top-level properties without rewriting callbacks."""
    prefix, suffix = "const extensions=createExtensionHost({", "});"
    body = registration.strip()
    if not body.startswith(prefix) or not body.endswith(suffix):
        raise ValueError("Preserve the complete original extension host registration")
    body = body[len(prefix):-len(suffix)]
    fields, start, stack, quote, escaped = [], 0, [], None, False
    pairs = {")": "(", "]": "[", "}": "{"}
    for index, char in enumerate(body):
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in ("'", '"', "`"):
            quote = char
        elif char in "([{":
            stack.append(char)
        elif char in ")]}":
            if not stack or stack.pop() != pairs[char]:
                raise ValueError("Preserve balanced original extension callbacks")
        elif char == "," and not stack:
            fields.append(body[start:index].strip())
            start = index + 1
    if quote or stack:
        raise ValueError("Preserve complete original extension callbacks")
    fields.append(body[start:].strip())
    result = {}
    for field in fields:
        if not field:
            continue
        name = field.split(":", 1)[0].strip()
        if not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name) or name in result:
            raise ValueError("Preserve unique explicit extension host capabilities")
        result[name] = field
    return result


def action_confirmation(source):
    """Retain the original legacy or admitted-task confirmation lifecycle."""
    confirmations = (
        "toast(actionLabels[action]+' retained.');",
        "toast((actionLabels[action] || action)+' retained.');",
        "toast((actionLabels[action]||action)+' retained.');",
    )
    count = sum(source.count(value) for value in confirmations)
    declarations = ("function retainedTaskNotice(ticket){",
                    "async function presentAcceptedTask(ticket,result){",
                    "async function submitAction(action,payload){")
    if any(declaration in source for declaration in declarations[:2]):
        required = (*declarations,
                    "(actionLabels[ticket.action]||ticket.action)+' retained in '+ticket.workspaceTitle",
                    "renderTasks();toast(retainedTaskNotice(ticket));",
                    "return presentAcceptedTask(ticket,result);")
        if count or any(source.count(value) != 1 for value in required):
            raise ValueError("Compose the original admitted-task confirmation lifecycle")
        return source
    if count != 1:
        raise ValueError("registered action confirmation: expected one current compatible anchor; found " + str(count))
    return source.replace(confirmations[0], confirmations[1], 1) if confirmations[0] in source else source


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
        " getProgramme:()=>typeof programmes==='undefined'?null:programmes});\n"
    )
    # Upgrade the first installed programme callback before checking whether the
    # complete registration is already present; never add a second host instance.
    source = source.replace(
        " openProgramme:selection=>typeof programmes!=='undefined'?programmes.create({selection}):extensions.openExtension('programmes','create',{selection})});",
        " getProgramme:()=>typeof programmes==='undefined'?null:programmes});", 1)
    first, last = "const extensions=createExtensionHost({", registration.splitlines(keepends=True)[-1]
    if first not in source:
        source = add(source, "function toast(message){", registration, "extension browser instance", before=True)
    else:
        if source.count(first) != 1 or source.count(last) != 1:
            raise ValueError("Expected one complete current extension browser instance")
        start, end = source.index(first), source.index(last, source.index(first)) + len(last)
        current = host_capabilities(source[start:end])
        for name, original in host_capabilities(registration).items():
            if current.get(name) != original:
                raise ValueError("Preserve and compose the current extension host capability: " + name)
    source = add(source, "    renderTasks();\n", "    extensions.update(state);\n",
                 "all task refreshes reach active desks")
    source = patch_view_lifecycle(source)
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
    # The current team-session host already loads desks after its original
    # authenticated workspace selection. Keep that complete startup in place.
    if source.count(startup) > 1:
        raise ValueError("authenticated desk startup: expected one installed desk loader")
    if startup not in source:
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
    native_title = ("openForm(saved?(nativeStudy?'Revise native-study delivery':'Revise complete map delivery')"
                    ":(nativeStudy?'Build complete native-study delivery':'Build complete seven-map delivery'),")
    if source.count(native_title) > 1:
        raise ValueError("new preselected delivery title: expected one native-study delivery form")
    if native_title not in source:
        source = replace(source,
            "openForm(row?'Revise complete map delivery':'Build complete seven-map delivery'",
            "openForm(saved?'Revise complete map delivery':'Build complete seven-map delivery'",
            "new preselected delivery title")
    return action_confirmation(source)


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
                known_previous = sha(before) in PREVIOUS_EDITIONS.get(name, set())
                if not equal_json and not known_previous:
                    raise ValueError("Current authored extension source differs: " + name +
                                     ". Reconcile that source edition before replacing it.")
                if equal_json:
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

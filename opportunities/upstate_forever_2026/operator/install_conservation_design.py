"""Install the complete Scenario design editor in an existing scientific application.

The original editor and conservation adapters keep their own implementation.
This joins the current shared host and adds the editor to both source collectors.
"""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import runpy
import stat
import sys
import tempfile

SCHEMA = "upstate.conservation-design-install/v1"
DIRECTORY = "scenario-design"
DATABASE_MODULE = "model/portable_databases.py"
DATABASE_MEMBER = "workspace/conservation-design/editor/projects.sqlite"
FILES = (
    "integration/conservation_design_composition.json",
    "model/CONSERVATION_CONSUMERS.md",
    "model/conservation_bindings.py",
    "model/conservation_scenarios.py",
    "model/conservation_design.py",
    "model/conservation_design_editor.py",
    "operator/CONSERVATION_DESIGN.md",
    "operator/CONSERVATION_DESIGN_EDITOR.md",
    "operator/CONSERVATION_DESIGN_BROWSER.md",
    "operator/conservation_design_browser_receiving.py",
    "operator/conservation_design.py",
    "operator/extensions/conservation-design.json",
    "operator/install_conservation_design.py",
    "operator/CONSERVATION_DESIGN_RECEIVING.md",
    "operator/web/conservation_design.css",
    "operator/web/conservation_design.mjs",
    "operator/web/conservation_design_editor.mjs",
    "operator/web/conservation_design_frame.js",
    "scenario-design/CONSERVATION.md",
    "scenario-design/INTEGRATION.md",
    "scenario-design/PERFORMANCE.json",
    "scenario-design/README.md",
    "scenario-design/SOURCE_MANIFEST.json",
    "scenario-design/__init__.py",
    "scenario-design/conservation.py",
    "scenario-design/eco_bridge.py",
    "scenario-design/engine.py",
    "scenario-design/requirements.txt",
    "scenario-design/server.py",
    "scenario-design/start.cmd",
    "scenario-design/start.sh",
    "scenario-design/tests/browser_journey.py",
    "scenario-design/tests/test_conservation_journey.py",
    "scenario-design/tests/test_journey.py",
    "scenario-design/tests/test_native_bridge.py",
    "scenario-design/tests/ui_transport.py",
    "scenario-design/tools/capacity_journey.py",
    "scenario-design/tools/pack_source.py",
    "scenario-design/web/app.js",
    "scenario-design/web/index.html",
    "scenario-design/web/style.css",
)
DEPENDENCIES = (
    "model/workspace.py", "model/common.py", "model/rasters.py",
    "model/conservation.py", "model/profiles.py", "model/reuse.py",
    "operator/extension_registry.py", "operator/web/extension_host.mjs",
    "install_extensions.py", "operator/conservation_browser_receiving.py",
)
SHARED = ("model/portable.py", DATABASE_MODULE, "operator/server.py", "operator/web/app.mjs")
ASSEMBLER = "source_tools/application_assembly.py"
PREDECESSORS = {
    "scenario-design/CONSERVATION.md": [
        "90fd85f3e7e26a5bbb4d9d61afd7f93eac4bad370576b78671a16b8db3d666a7"
    ],
    "scenario-design/INTEGRATION.md": [
        "17182b02cbb39118707d0524be302a5ab70efe5a157984c8f518fad24c99b704"
    ],
    "scenario-design/PERFORMANCE.json": [
        "2587359432e002e90eda733fbd4f303bffaf65bfd93d66facea133d150a9fcb1"
    ],
    "scenario-design/README.md": [
        "bb70d4ca22d33e90a3bfdf6f5cd376329a2195e7a9261b2a41b498b6305140ba"
    ],
    "scenario-design/SOURCE_MANIFEST.json": [
        "86c8f36734f03d252e1549d024d653be9ea1cdabcd85493ccfad06aac50839bc",
        "eeaae93824f804dd3d5d694792135b4368d2aaadd9e453105d81733673b4aa71",
        "103ea7faa1c2af283dd675c909a6b9de656b99f9f8620402e3a2f91033f7683d"
    ],
    "scenario-design/conservation.py": [
        "d635b010c420c4c55e8ad601407b6293c5b6d329ae2a9b87d009c5a88f02a9fb"
    ],
    "scenario-design/eco_bridge.py": [
        "8197fbe50bce6b7c9f0d7be4c4bf1a134dfa8350b4f183feee3834b5b02dcc6b",
        "6d719d80b1ffda0be74d5b22dcf0f47cd515f8a3835c5c6ab5b6709075858b6f"
    ],
    "scenario-design/engine.py": [
        "99a1ba9f99ba102a1be058c693b4b2d339c812f01c01a6a47da66ef0694aa327",
        "916d8242c1df03e42a784a8cc69833c050eb814a840b13f30194eb46fa99fa2a"
    ],
    "scenario-design/requirements.txt": [
        "ea37d77c317d16578ef4d395336b9788cc92cd58125e2783936f9a456eb60959"
    ],
    "scenario-design/server.py": [
        "7399475fcbb8aceeb4b234e96f669871bd53d11f067a29ea9e78e0827d72a024",
        "1056f4969ffc948a8551dc7f412f606d9d3d2cebd0f09bb87c0bcbd55b7f1841"
    ],
    "scenario-design/start.cmd": [
        "d8ae6297a4a7592be58178a855632a49bf10977b4938a165da5d3b1223484170"
    ],
    "scenario-design/start.sh": [
        "478c3b9186ce629ddcf5b9680936e89fc5883aa2cb9563c2a27bf9a7b7f14e4d"
    ],
    "scenario-design/tests/browser_journey.py": [
        "975cb0850fbea4ac91495c37ca08b68ce23975d66b641bfe8667145709fae459"
    ],
    "scenario-design/tests/test_conservation_journey.py": [
        "f0faf03bca9e80b7940a348706c8ed2ea7da4367640e8746deb7046dff1c36c2"
    ],
    "scenario-design/tests/test_journey.py": [
        "eb4ec2d1ba53316d4aebd2e8c2bd3562d58f9b705fc9e37a85f00a5d18c553bb"
    ],
    "scenario-design/tests/test_native_bridge.py": [
        "950481c8d96cf577679c261a754f18af70933f487fed5883d974ea51bb8c18c3"
    ],
    "scenario-design/tests/ui_transport.py": [
        "d5f0a6e6cb55e29010e3a02efe7e526f5fd66c2efd4b28c427b88b53262d7273"
    ],
    "scenario-design/tools/capacity_journey.py": [
        "002e65f52e74e7096c130aa0f6578355e9781589f4ab607e28fb760a12b50530"
    ],
    "scenario-design/tools/pack_source.py": [
        "34c68625641961dab0bf4760e21ed50f55e91feea1f76197161c69137ce056a4"
    ],
    "scenario-design/web/app.js": [
        "b8b82de5ad0197b7ba0d8bd508dc7f7ea4e281d7b3f30c24659ab5a11daddbc5"
    ],
    "scenario-design/web/index.html": [
        "6824f9527fba3a9a2c4a023fcad316a7c21720318930202bbf8b88512fa02a4a"
    ],
    "scenario-design/web/style.css": [
        "31c05a843dc3ea688d62b2054264d80f5957723d76504cdbf25d87624be6a4f9"
    ],
    "scenario-design/__init__.py": [
        "4e977437bc571e6da8c8b3060c67e789af659a5676fa2cb4b3a328a141b3b168"
    ],
    "model/conservation_design.py": [
        "c34a4a8d28b78f1bab049213183fec51d6596fe89b1d908ad0abab6e58dbd91f"
    ],
    "operator/conservation_design.py": [
        "58b76335b6b8f8f8c6a2d11d2271c8210f34b822990eb635d83db3d93b17684e",
        "be9637b9494fb35e39a1cd1740d93201e016e444b4d1b60fbe27ce3b5d7fe8a4",
        "6f67f91e217ef79ec818cb67912bb43d76dbda90d381dff9adf6ff60e13d84ad"
    ],
    "operator/extensions/conservation-design.json": [
        "05a0d15df2b22f0ae3cfb3bcbf50b4474a2ad534fc475194de35e3b06a7cf591",
        "98929c6559caac73bb07d20fa5ff48eaa0476051bc4f59a44253f937047d54d8"
    ],
    "operator/web/conservation_design.mjs": [
        "828c579f7108609af4b94062d453defe9bcdf6420e66d070eb6edf3940c7ce8a",
        "d591e5d2b08b4eebf59c03578d6f4fdac07e92d215c7ea23e9dcf1753a7688c1",
        "f18f8522322b1ffb7d48ae220a511e3b7c7dd7e31ec3b273d3675cbff4ffea6b"
    ],
    "operator/web/conservation_design.css": [
        "0642c88ad7a19d5eb1180a775fbf7e59b45346530ae215ab4a068b0bc1a90efc",
        "8754c8297f6b441d181b5746fa04a3e1857ff381f9e0f97c8ee81c0066df1864"
    ],
    "operator/CONSERVATION_DESIGN.md": [
        "51659614cab8da4e9e4624e77f0fdd4b7074e7d013f5cba85b55a2ac3b5a4a89",
        "bb87c3a4a63ccf9e9d7fbca7e8ee9193f0387b80eba1305a8e40ec249c9dd262",
        "11d6864d992d58f26da4b988f9d718ec943b91af74854747bff28079cd2075a8"
    ],
    "integration/conservation_design_composition.json": [
        "68c6ffe3157cf5c8c54b074f48fec32262d40b9a574b497a03de57fd51b70f58",
        "f39eeb44abb5e9cee585114c0e790c5a43e73a9d9c192682b78f4d76ccfa36ca",
        "1eb473f5b18165d8214a1fd17fc78379c4c15462db1c8ef702c419865de03788",
        "0c79e65fa6788c2c0a13a3f973950cb48050b0dd4d544c4818c472d2946b50dd",
        "a19c70b696c4a89b455ca3f0c98fc9f4c2545844aa077c43955f503587a2bc66"
    ],
    "model/conservation_bindings.py": [
        "f23070f1298b90614ce51898c02f41bb9be8cdaf90bcb3b43627b768000dcb62",
        "172dad7c968aa41c384387950ce306f1dfe34a8d3d04d4bb56c180d0c0845cda"
    ],
    "model/CONSERVATION_CONSUMERS.md": [
        "9bf8e53f678c907d66c3225f3738370bce2efa916eae59e44073fc51b5d069e9",
        "9bcc0a413f9d2e8feec08d2ff827c829e1a875d977519e3b61edb7f907f3b5e9"
    ],
    "model/conservation_scenarios.py": [
        "7d219c37ccd94094bf1e3355433ed12499a5aec389220cc7608d76140643ae6d",
        "2bc3fa18d2ed4e8b59310e4a442411b7f7b91aec585ac2d1916060ce8345e25b"
    ],
    "model/conservation_design_editor.py": [
        "5a61fd73c7f7de5c68215d91f5160bbf0797d790d9db15ffc8869a7f8b8dc587",
        "06ec5046ecaaa8bb69b3fd865afb859f06ebe20e126a67f1f6bf6714a9295112"
    ],
    "operator/web/conservation_design_editor.mjs": [
        "049ccb1a6b1971378acc77090b8ea6cf36996f48c3e5971d9a115b11e2af7b3c",
        "6e85ab160629609296a2e77cf62a3b04f5b87b86d9809f3bb937e3430f58d013"
    ],
    "operator/web/conservation_design_frame.js": [
        "1fcf2486bb010a55fd9308e76554106980779f2d3c0e084dc2ecb3b63c3b66b2"
    ],
    "operator/CONSERVATION_DESIGN_EDITOR.md": [
        "4f25a1ded3c1c9e1ac80e40d1693b6c3bba0b5e4a9c45411e6d50174bcbdb283"
    ],
    "operator/install_conservation_design.py": [
        "0f532e73bf900afa43bb59c148bf5b56b2140d04435b00001b28933e8dd65de1"
    ],
    "operator/CONSERVATION_DESIGN_RECEIVING.md": [
        "1cf145d7a459f7c33aa9507c6d71b36567365a50e46f24f87b850295c920f986"
    ],
    "operator/conservation_design_browser_receiving.py": [
        "2e2c711cff2052a61e8d49598ac7e80eb16365441f18b4a513fad3962d09ad73",
        "c9acbb06ce9a2ecc748845fac0ff84c17e137c2fdffe5365b898d1b364d485a3"
    ],
    "operator/CONSERVATION_DESIGN_BROWSER.md": [
        "1d868453463464468233673dd7584810a6341aa1413f6850eb8e13e9bb219ccd",
        "c24784f0512beddd3a2485d93de3e6072b4475d50ba37c0e90653ababb393c3b"
    ]
}


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _path(root, name):
    path = root / name
    for item in (path, *path.parents):
        if item.is_symlink():
            raise ValueError("Source path contains an alias: " + str(item))
        if item == root:
            break
    return path


def _read(root, name, *, required=True):
    path = _path(root, name)
    if not path.exists():
        if required:
            raise ValueError("Receive the complete source dependency: " + name)
        return None
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError("Source must be a regular file: " + name)
    return path.read_bytes()


def _directory_literal(source, variable, *, directories, function=None):
    """Extend one current string inventory; preserve its type and other source."""
    tree = ast.parse(source)
    scope = tree
    if function:
        matches = [node for node in tree.body
                   if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and node.name == function]
        if len(matches) != 1:
            raise ValueError("Compose the current source collector: " + function)
        scope = matches[0]
    assignments = []
    for node in scope.body:
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        else:
            continue
        if any(isinstance(target, ast.Name) and target.id == variable for target in targets):
            assignments.append(node.value)
    if len(assignments) != 1:
        raise ValueError("Compose the unique current directory inventory: " + variable)
    value = assignments[0]
    if not isinstance(value, (ast.Tuple, ast.List, ast.Set)):
        raise ValueError("The current source inventory must remain a literal: " + variable)
    selected = ast.literal_eval(value)
    if isinstance(value, ast.Set):
        selected = sorted(selected)
    if not all(isinstance(item, str) and item for item in selected):
        raise ValueError("The source directory inventory needs original directory names")
    additions = [*selected, *(name for name in directories if name not in selected)]
    if list(selected) == additions:
        return source
    if isinstance(value, ast.Set):
        literal = "{" + ", ".join(repr(name) for name in additions) + "}"
    else:
        literal = repr(tuple(additions) if isinstance(value, ast.Tuple) else additions)
    replacement = literal.encode("utf-8")
    lines = source.encode("utf-8").splitlines(keepends=True)
    start = sum(map(len, lines[:value.lineno - 1])) + value.col_offset
    end = sum(map(len, lines[:value.end_lineno - 1])) + value.end_col_offset
    body = source.encode("utf-8")
    result = (body[:start] + replacement + body[end:]).decode("utf-8")
    ast.parse(result)
    return result


def _assembler_directories(source, directories):
    tree = ast.parse(source)
    collectors = [node for node in tree.body
                  if isinstance(node, ast.FunctionDef) and node.name == "_source_inventory"]
    if len(collectors) != 1:
        raise ValueError("Compose the current installed-source collector")
    declarations = [node.value for node in collectors[0].body
                    if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == "roots"
                            for target in node.targets)]
    if len(declarations) == 1:
        value = declarations[0]
        if (isinstance(value, ast.Call) and isinstance(value.func, ast.Name)
                and value.func.id == "_installed_source_directories"):
            resolvers = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                         and node.name == "_installed_source_directories"]
            if (len(resolvers) != 1 or not any(isinstance(node, ast.Constant)
                    and node.value == "APPLICATION_DIRECTORIES" for node in ast.walk(resolvers[0]))):
                raise ValueError("Verify the current assembler's portable-inventory resolver")
            # The maintained current resolver reads the installed portable source.
            # Extending that actual declaration already extends its snapshot roots.
            return source
    return _directory_literal(source, "roots", directories=directories,
                              function="_source_inventory")


def inventory_sources(sources, *, directories=(DIRECTORY,)):
    """Extend original collectors for the explicitly received source namespaces."""
    if not isinstance(directories, (tuple, list)) or not directories:
        raise ValueError("Choose the complete received application source directories")
    if any(not isinstance(name, str) or not name or name.startswith(".")
           or "/" in name or "\\" in name or "\0" in name for name in directories):
        raise ValueError("Each application source directory must be one ordinary root name")
    directories = tuple(dict.fromkeys(directories))
    if "model/portable.py" not in sources:
        raise ValueError("Receive the current scientific Workspace portable module")
    result = {"model/portable.py": _directory_literal(
        sources["model/portable.py"], "APPLICATION_DIRECTORIES", directories=directories)}
    if ASSEMBLER in sources:
        result[ASSEMBLER] = _assembler_directories(sources[ASSEMBLER], directories)
    if DIRECTORY in directories and DATABASE_MODULE in sources:
        result[DATABASE_MODULE] = _directory_literal(
            sources[DATABASE_MODULE], "MUTABLE_DATABASE_MEMBERS",
            directories=(DATABASE_MEMBER,))
    return result


def restore_sources(sources):
    """Join original design validators to the current provider without replacing its edits."""
    descriptor_name = "operator/extensions/conservation-design.json"
    provider_name = "operator/conservation_design.py"
    descriptor = json.loads(sources[descriptor_name])
    backend = descriptor.get("backend", {})
    if backend.get("verify_workspace"):
        return {}
    if backend.get("module") != "conservation_design":
        raise ValueError("Compose the current Scenario design provider registration")
    factory = backend.get("factory", {})
    if not isinstance(factory, dict) or not isinstance(factory.get("handler"), str):
        raise ValueError("Receive the original Scenario design provider factory")
    text = sources[provider_name]
    tree = ast.parse(text)
    classes = [node for node in tree.body
               if isinstance(node, ast.ClassDef) and node.name == factory["handler"]]
    if len(classes) != 1:
        raise ValueError("Compose the actual Scenario design provider factory")
    provider = classes[0]
    if any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
           and node.name == "verify_workspace" for node in provider.body):
        raise ValueError("Register the original provider's existing workspace verifier")
    method = '''
    def verify_workspace(self, workspace):
        """Reopen the original retained designs after portable receiving."""
        from model import conservation_design as original_design
        summary = original_design.overview(workspace)
        preparations = [original_design.get_preparation(workspace, row["id"])
                        for row in summary["preparations"]]
        receivings = [original_design.get_receiving(workspace, row["id"])
                     for row in summary["receivings"]]
        return {
            "conservation_design_preparations": [row["id"] for row in preparations],
            "conservation_design_receivings": [row["id"] for row in receivings],
            "verified_count": len(preparations) + len(receivings),
        }
'''
    lines = text.splitlines(keepends=True)
    position = sum(map(len, lines[:provider.end_lineno]))
    joined = text[:position].rstrip("\r\n") + "\n" + method + text[position:]
    compile(joined, provider_name, "exec")
    backend["verify_workspace"] = {"handler": "verify_workspace", "args": ["workspace"]}
    return {provider_name: joined,
            descriptor_name: json.dumps(descriptor, ensure_ascii=False, indent=2) + "\n"}


def _validate_sources(incoming):
    for name, data in incoming.items():
        if name.endswith(".py"):
            compile(data.decode("utf-8"), name, "exec")
    descriptor = json.loads(incoming["operator/extensions/conservation-design.json"])
    if (descriptor.get("schema") != "upstate.operator-extension/v1"
            or descriptor.get("id") != "conservation-design"
            or descriptor.get("backend", {}).get("module") != "conservation_design"):
        raise ValueError("Receive the original Scenario design extension descriptor")
    backend = descriptor.get("backend", {})
    if not {"conservation.design.editor.open", "conservation.design.editor.write"}.issubset(backend.get("actions", ())):
        raise ValueError("Receive the complete embedded-editor action registration")
    if "conservation_design_editor.mjs" not in descriptor.get("assets", ()):
        raise ValueError("Receive the embedded-editor parent browser asset registration")
    if not any(route.get("path") == "/api/conservation-design/editor"
               and "POST" in route.get("methods", ()) for route in backend.get("routes", ())):
        raise ValueError("Receive the original embedded-editor read route")
    if not any(route.get("path") == "/api/file/conservation-design/{workspace_key}/editor/{member_path...}"
               and route.get("response") == "ticket_policy_pair"
               for route in backend.get("file_routes", ())):
        raise ValueError("Receive the original embedded-editor authenticated file transport")
    manifest = json.loads(incoming["scenario-design/SOURCE_MANIFEST.json"])
    if not isinstance(manifest, dict) or not manifest:
        raise ValueError("Receive the complete original editor source manifest")
    expected = {name.removeprefix(DIRECTORY + "/") for name in incoming
                if name.startswith(DIRECTORY + "/")
                and name != "scenario-design/SOURCE_MANIFEST.json"}
    if set(manifest) != expected:
        raise ValueError("The editor manifest and complete source inventory differ")
    for name, record in manifest.items():
        body = incoming[DIRECTORY + "/" + name]
        if record.get("bytes") != len(body) or record.get("sha256") != _hash(body):
            raise ValueError("Editor source differs from its original manifest: " + name)


def _atomic(path, data, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".design-install-", delete=False) as stream:
            pending = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(pending, mode)
        os.replace(pending, path)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def install(application, source, *, preview=False):
    """Compose, validate and install the complete component in the current application."""
    application, source = Path(application).absolute(), Path(source).absolute()
    for root in (application, source):
        for item in (root, *root.parents):
            if item.is_symlink():
                raise ValueError("Choose an ordinary application/source directory")
        if not root.is_dir():
            raise ValueError("Choose an existing application/source directory")
    dependencies = {name: _read(application, name) for name in DEPENDENCIES}
    current = {name: _read(application, name) for name in SHARED}
    assembler = _read(application, ASSEMBLER, required=False)
    if assembler is not None:
        current[ASSEMBLER] = assembler
    incoming = {name: _read(source, name) for name in FILES}
    scenario_tree = ast.parse(incoming["model/conservation_scenarios.py"].decode("utf-8"))
    scenario_methods = {node.name for node in scenario_tree.body if isinstance(node, ast.FunctionDef)}
    if not {"_effective_run", "_validate_run"}.issubset(scenario_methods):
        raise ValueError("Receive the current original conservation_scenarios.py with native model-scope resolution")
    _validate_sources(incoming)
    database_tree = ast.parse(current[DATABASE_MODULE].decode("utf-8"))
    database_methods = {node.name for node in database_tree.body
                        if isinstance(node, ast.FunctionDef)}
    if not {"snapshot_databases", "without_database_files", "verify_database_sources"}.issubset(database_methods):
        raise ValueError("Receive the maintained SQLite online-backup source before installing the embedded editor")
    portable_tree = ast.parse(current["model/portable.py"].decode("utf-8"))
    if not any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
               and node.func.id == "snapshot_databases" for node in ast.walk(portable_tree)):
        raise ValueError("Receive the maintained Workspace archive with its original SQLite snapshot integration")
    host = runpy.run_path(str(application / "install_extensions.py"))
    if not all(callable(host.get(name)) for name in ("patch_server", "patch_app")):
        raise ValueError("Receive the maintained extension installer's source composition API")
    composed = inventory_sources({name: body.decode("utf-8") for name, body in current.items()})
    composed["operator/server.py"] = host["patch_server"](current["operator/server.py"].decode("utf-8"))
    composed["operator/web/app.mjs"] = host["patch_app"](current["operator/web/app.mjs"].decode("utf-8"))
    restored = restore_sources({name: incoming[name].decode("utf-8") for name in (
        "operator/conservation_design.py", "operator/extensions/conservation-design.json")})
    changes = {**incoming, **{name: body.encode("utf-8") for name, body in restored.items()},
               **{name: body.encode("utf-8") for name, body in composed.items()}}
    for name, body in changes.items():
        if name.endswith(".py"):
            compile(body.decode("utf-8"), name, "exec")
    lock = _path(application, "operator/.conservation-design-install.lock")
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        receipt_name = "operator/conservation-design-install.json"
        previous_data = _read(application, receipt_name, required=False)
        previous = json.loads(previous_data) if previous_data else {}
        originals, modes = {}, {}
        for name, body in changes.items():
            before = _read(application, name, required=False)
            originals[name] = before
            path = _path(application, name)
            modes[name] = stat.S_IMODE(path.stat().st_mode) if before is not None else (
                0o755 if name == "scenario-design/start.sh" else 0o644)
            if (name in incoming and before is not None and before != body
                    and before != incoming[name]):
                known = previous.get("installed", {}).get(name)
                if known != _hash(before) and _hash(before) not in PREDECESSORS.get(name, ()):
                    raise ValueError("Compose the independently updated component source: " + name)
            if name in current and before != current[name]:
                raise ValueError("The current source changed during composition: " + name)
        rows = [{"path": name, "before_sha256": _hash(originals[name]) if originals[name] is not None else None,
                 "sha256": _hash(body), "bytes": len(body), "changed": originals[name] != body}
                for name, body in sorted(changes.items())]
        dependency_hashes = {name: _hash(body) for name, body in dependencies.items()}
        operation_id = _hash(json.dumps({"files": rows, "dependencies": dependency_hashes},
                                       sort_keys=True, separators=(",", ":")).encode("utf-8"))
        result = {"schema": SCHEMA, "operation_id": operation_id,
                  "application": str(application), "files": rows,
                  "dependencies": dependency_hashes,
                  "application_directories": [DIRECTORY],
                  "assembler_present": assembler is not None,
                  "assembler_updated": assembler is not None and changes[ASSEMBLER] != assembler,
                  "catalogue": "/api/conservation-design/overview",
                  "editor_database_member": DATABASE_MEMBER,
                  "editor_database_snapshot": "sqlite-online-backup",
                  "changed_files": sum(row["changed"] for row in rows)}
        if preview:
            return {**result, "state": "prepared"}
        for name, before in dependencies.items():
            if _read(application, name) != before:
                raise ValueError("A retained dependency changed during preparation: " + name)
        history = application / ".conservation-design-install-history" / operation_id
        journal = {**result, "state": "prepared",
                   "installed": {name: _hash(body) for name, body in changes.items()}}
        _atomic(history / "operation.json",
                (json.dumps(journal, indent=2, sort_keys=True) + "\n").encode("utf-8"), 0o600)
        written = []
        try:
            for name, body in changes.items():
                before = originals[name]
                if _read(application, name, required=False) != before:
                    raise ValueError("Concurrent source changed before installation: " + name)
                if before == body:
                    continue
                if before is not None:
                    _atomic(history / name, before, modes[name])
                _atomic(_path(application, name), body, modes[name])
                written.append(name)
            for name, body in dependencies.items():
                if _read(application, name) != body:
                    raise ValueError("A retained dependency changed during installation: " + name)
            for name, body in changes.items():
                if _read(application, name) != body:
                    raise ValueError("Installed source changed before completion: " + name)
            complete = {**journal, "state": "installed"}
            _atomic(_path(application, receipt_name),
                    (json.dumps(complete, indent=2, sort_keys=True) + "\n").encode("utf-8"), 0o644)
        except BaseException:
            # Only undo this operation's unchanged postimages; preserve newer writers.
            for name in reversed(written):
                path = _path(application, name)
                if _read(application, name, required=False) != changes[name]:
                    continue
                if originals[name] is None:
                    path.unlink()
                else:
                    _atomic(path, originals[name], modes[name])
            raise
        return {**result, "state": "installed"}
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(install(args.application, args.source, preview=args.preview), indent=2, sort_keys=True))
        return 0
    except (OSError, ValueError, SyntaxError) as error:
        print(json.dumps({"state": "failed", "type": type(error).__name__, "message": str(error)}),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Install the native scenario footprint kernel and its additive operator."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import tempfile

ORIGINAL_KERNEL_SHA = "a078145d2e06669afc68d81a7dff7968d118ae8d62ea028a135e523b54cbb1e5"
BINARY_KERNEL_SHA = "4b4e70fd50ba3de207f710d69b1d28acbe965176140bc482794e4a403e6d4a29"
BEGIN = "# BEGIN NATIVE SCENARIO FOOTPRINT"
END = "# END NATIVE SCENARIO FOOTPRINT"
KERNEL = '''def make_scenario(baseline, destination, grid, patches, *, source_loader, allowed_codes):
    """Apply ordered native edits and count actual value changes."""
    from .scenario_footprint import make_scenario as apply_footprint
    return apply_footprint(baseline, destination, grid, patches,
                           source_loader=source_loader, allowed_codes=allowed_codes)
'''
BOOT = '''
# BEGIN NATIVE SCENARIO FOOTPRINT
import importlib.util as _upstate_footprint_import
_upstate_footprint_spec = _upstate_footprint_import.spec_from_file_location(
    "upstate_operator_scenario_footprint",
    Path(__file__).resolve().parent / "scenario_footprint.py")
_upstate_footprint_module = _upstate_footprint_import.module_from_spec(_upstate_footprint_spec)
_upstate_footprint_spec.loader.exec_module(_upstate_footprint_module)
_upstate_footprint_module.install(globals())
# END NATIVE SCENARIO FOOTPRINT

'''
NAV = '<script type="module" src="/web/scenario-footprint-nav.mjs"></script>'
FILES = ("model/scenario_footprint.py", "operator/scenario_footprint.py",
         "operator/web/scenario-footprint.html", "operator/web/scenario-footprint.css",
         "operator/web/scenario-footprint.mjs", "operator/web/scenario-footprint-nav.mjs",
         "operator/web/scenario_input_review.mjs",
         "operator/SCENARIO_FOOTPRINT.md", "operator/install_scenario_footprint.py",
         "source/scenario-footprint/reference_ordered_patches.py",
         "operator/extensions/scenario-footprint.json",
         "source/scenario-footprint/reference_binary_masks.py")

INSTALL_ROOT = "source/scenario-footprint-install"
KNOWN_RELEASED = {
    "model/scenario_footprint.py": [
        "ccedbcfd4c0f03471d079f3d4a2d73f08fff5372a5b7d8a61375655b46fe7fe3",
        "a856434c35e1024513200ddc64003337fe1e5954f1cc5ba82e205ef26e6b5f5a"
    ],
    "operator/scenario_footprint.py": [
        "4cc34d196908b89e9c059b1bef6cd4f499866b80c75e1bd5c04df7f76ae00951",
        "b00debeade76c166ca6382358e4e56dc1af1f39bdf8f2f6d6a165976c58f9a47"
    ],
    "operator/web/scenario-footprint.html": [
        "cd0109abd6b19dffea4f2d39588b2b7c5154bd870bc3336a69d661f2d1cb4777"
    ],
    "operator/web/scenario-footprint.css": [
        "51a8f137f08019a80208ca2afaaaeef98b7ac039d3f665546855f34b26e3a865"
    ],
    "operator/web/scenario-footprint.mjs": [
        "aa4eac126c6158fdab4a3ae9e8c71e516f90e2c992a26b7d13d5570d2fd64935"
    ],
    "operator/web/scenario-footprint-nav.mjs": [
        "bfe45c1dc77b63620117f6dc2aa9cea01e770f6d0f6f690da23d38a673288b0a"
    ],
    "operator/SCENARIO_FOOTPRINT.md": [
        "42be4e6e39d626d30fc0d9f0e875800adceb46bf0dbb8adfed786018bc018cac",
        "577bd7261d6065278958e028f0de3715216e1c558714dc909b4f6fb74b826017"
    ],
    "operator/install_scenario_footprint.py": [
        "157d052c8b7f094075b73d8b007d5e2727976b334c1de6ce6b88aa0bcad50b54",
        "9abd396262dc899ad69049916eff714dfb3143f0c0dfc48a63d99ba59aa282f4",
        "ce2c2a9789ca5168423602dfca719e1fd03e21506640065671b23e6a5b6a1618"
    ],
    "source/scenario-footprint/reference_ordered_patches.py": [
        "e64c7e4ab6948385770442310813f84c2e89aa85167e6e351f473c7c07f19880"
    ]
}

# Exact complete component received before current binary-mask composition.
for _path, _fingerprint in {
    "model/scenario_footprint.py": "a856434c35e1024513200ddc64003337fe1e5954f1cc5ba82e205ef26e6b5f5a",
    "operator/scenario_footprint.py": "c19fc7ca4e464663c30d042bd52a6f01c1ad11a1f7b299e7f213dcfd60f2f862",
    "operator/web/scenario-footprint.html": "9aac468a367bcb79049aba0e9b08df3b5865a95e990cea56f51d86d1ff5e4db8",
    "operator/web/scenario-footprint.css": "2ace2265dbeb1149b595aa259aee89b4a02cfc6c9bb20b906e37a7ff476923de",
    "operator/web/scenario-footprint.mjs": "6ed171b0299bbe54b48afc655d3c1f2992f5833c5d4b6c1d8eca09c4e30ff220",
    "operator/web/scenario-footprint-nav.mjs": "bfe45c1dc77b63620117f6dc2aa9cea01e770f6d0f6f690da23d38a673288b0a",
    "operator/SCENARIO_FOOTPRINT.md": "4793cab73264222eb20b149299df61b3b931f55b4da3dde20b11c001b9806d4b",
    "operator/install_scenario_footprint.py": "369f0bb9fa00e5be6ce5b712ee429ac65b55010ce05095ca2cf444cb3de93868",
    "source/scenario-footprint/reference_ordered_patches.py": "e64c7e4ab6948385770442310813f84c2e89aa85167e6e351f473c7c07f19880",
    "operator/extensions/scenario-footprint.json": "993a8441c03823e44787508917aceb0724d41e295a1ed611e7cea8309180a1bc"
}.items():
    KNOWN_RELEASED.setdefault(_path, []).append(_fingerprint)



# Complete published operator edition before ordinary input-review integration.
for _path, _fingerprint in {
    "operator/extensions/scenario-footprint.json": "8da5a76e5402433ab57431a3f89c299bd7828ea2564a1b9f8c66b0648e2cf4a5",
    "operator/web/scenario-footprint.mjs": "6fb666959e648d28056b6b28a25488243a97fde457cf77f39d6661e47996d9c5",
    "operator/SCENARIO_FOOTPRINT.md": "198441a04201ea8d410080ab668c26dcde109e6d32332d63562fa46d8966d6b1",
    "operator/install_scenario_footprint.py": "35577a4503a5f11c583b4b52c96fa658654ee6e2b874a93596f667b231fa5892"
}.items():
    KNOWN_RELEASED.setdefault(_path, []).append(_fingerprint)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def atomic(path, body, expected):
    if path.is_symlink():
        raise ValueError("Use a regular application source path")
    path.parent.mkdir(parents=True, exist_ok=True)
    observed = path.read_bytes() if path.exists() else None
    if observed != expected:
        raise ValueError("Application source changed during installation: " + str(path))
    if observed == body:
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".scenario-install-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o644)
        observed = path.read_bytes() if path.exists() else None
        if observed != expected:
            raise ValueError("A colleague changed the application before replacement: " + str(path))
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def patch_kernel(text):
    tree = ast.parse(text)
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "make_scenario"]
    if len(functions) != 1:
        raise ValueError("Select the original single make_scenario entrypoint")
    function = functions[0]
    lines = text.splitlines(keepends=True)
    original = "".join(lines[function.lineno - 1:function.end_lineno]).rstrip() + "\n"
    if original == KERNEL:
        return text
    if sha(original.encode("utf-8")) not in {ORIGINAL_KERNEL_SHA, BINARY_KERNEL_SHA}:
        raise ValueError("make_scenario has a current independent revision; compose this complete footprint kernel with that exact source")
    lines[function.lineno - 1:function.end_lineno] = [KERNEL]
    return "".join(lines)


def patch_prepare(text):
    if "from .scenario_footprint import validate_destination_codes" in text:
        return text
    tree = ast.parse(text)
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Workspace"]
    if len(classes) != 1:
        raise ValueError("Select the original Workspace class")
    methods = [node for node in classes[0].body if isinstance(node, ast.FunctionDef) and node.name == "prepare_run"]
    if len(methods) != 1:
        raise ValueError("Select the current Workspace.prepare_run method")
    method = methods[0]
    anchors = {}
    for node in method.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target, value = node.targets[0], node.value
        if not isinstance(target, ast.Name) or target.id not in {"profile", "scenario"}:
            continue
        if not (isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute)
                and value.func.attr == "_get" and isinstance(value.func.value, ast.Name)
                and value.func.value.id == "self" and value.args
                and isinstance(value.args[0], ast.Constant)
                and value.args[0].value == target.id + "s"):
            continue
        anchors[target.id] = node.end_lineno
    if set(anchors) != {"profile", "scenario"}:
        raise ValueError("The current prepare_run source has different profile/scenario loaders; place validate_destination_codes immediately after its two retained records are loaded")
    at = max(anchors.values())
    indent = " " * (method.col_offset + 4)
    addition = (indent + "from .scenario_footprint import validate_destination_codes\n" +
                indent + "validate_destination_codes(profile, scenario)\n")
    lines = text.splitlines(keepends=True)
    lines[at:at] = [addition]
    return "".join(lines)



def recorded_ownership(application):
    """Positive ownership from published sources and durable prior install intents."""
    hashes = {path: set(values) for path, values in KNOWN_RELEASED.items()}
    root = application / INSTALL_ROOT
    for path in [root / "current.json", *sorted(root.glob("*/intent.json"))]:
        if not path.exists():
            continue
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("schema") not in {"upstate.scenario-footprint-install/v1",
                                        "upstate.scenario-footprint-install-intent/v1"}:
            continue
        for row in value.get("owned_files", []):
            relative = row.get("path")
            if relative in FILES:
                for key in ("sha256", "previous_sha256"):
                    fingerprint = row.get(key)
                    if isinstance(fingerprint, str) and len(fingerprint) == 64:
                        hashes.setdefault(relative, set()).add(fingerprint)
    return hashes


def install(application, source=None, *, model_only=False):
    application = Path(application).resolve(strict=True)
    source = Path(source).resolve() if source else Path(__file__).resolve().parent.parent
    source = source if source.is_dir() else source.parent
    selected = list(FILES[:1] if model_only else FILES)
    owned = recorded_ownership(application)
    current_path = application / INSTALL_ROOT / "current.json"
    current_before = current_path.read_bytes() if current_path.exists() else None
    originals = {}
    edits = []
    registry_mode = False
    for relative, patch in (("model/rasters.py", patch_kernel), ("model/workspace.py", patch_prepare)):
        path = application / relative
        body = path.read_bytes()
        updated = patch(body.decode("utf-8")).encode("utf-8")
        originals[relative] = body
        edits.append((path, updated, body))
    if not model_only:
        server = application / "operator/server.py"
        index = application / "operator/web/index.html"
        before = server.read_bytes()
        text = before.decode("utf-8")
        registry_mode = ("from extension_registry import ExtensionRegistry" in text and
                         "self.extensions = ExtensionRegistry(" in text)
        if BEGIN in text:
            start, stop = text.index(BEGIN), text.index(END) + len(END)
            if text[start:stop] != BOOT.strip():
                raise ValueError("The installed footprint operator launcher has another current revision")
            if registry_mode:
                text = text[:start] + text[stop:]
        elif not registry_mode:
            marker = 'if __name__ == "__main__":'
            if text.count(marker) != 1:
                raise ValueError("Integrate the supplied install(namespace) at the current original server entrypoint")
            text = text.replace(marker, BOOT + marker)
        edits.append((server, text.encode("utf-8"), before))
        originals["operator/server.py"] = before
        before = index.read_bytes()
        html = before.decode("utf-8")
        if registry_mode:
            html = html.replace(NAV, "")
        elif NAV not in html:
            if html.count("</head>") != 1:
                raise ValueError("The current operator page has a different head")
            html = html.replace("</head>", NAV + "\n</head>")
        edits.append((index, html.encode("utf-8"), before))
        originals["operator/web/index.html"] = before

    pending = []
    for relative in selected:
        body = (source / relative).read_bytes()
        target = application / relative
        if not target.parent.resolve().is_relative_to(application) or target.is_symlink():
            raise ValueError("A component path leaves the selected application")
        expected = target.read_bytes() if target.exists() else None
        if expected is not None and expected != body:
            if sha(expected) not in owned.get(relative, set()):
                raise ValueError("Review the independent changes in footprint source before replacing: " + relative)
            originals[relative] = expected
        pending.append((target, body, expected))
    pending.extend(edits)
    for path, body, _ in pending:
        if path.suffix == ".py":
            ast.parse(body.decode("utf-8"), filename=str(path))

    if current_before is not None and all(expected == body for _, body, expected in pending):
        current = json.loads(current_before)
        recorded = {row["path"]: row for row in current.get("files", [])}
        if all(recorded.get(str(path.relative_to(application)), {}).get("sha256") == sha(body)
               and recorded[str(path.relative_to(application))].get("bytes") == len(body)
               for path, body, _ in pending):
            print(json.dumps(current, indent=2))
            return current

    owned_files = [{"path": str(path.relative_to(application)), "bytes": len(body),
                    "sha256": sha(body),
                    "previous_sha256": sha(expected) if expected is not None else None}
                   for path, body, expected in pending if str(path.relative_to(application)) in FILES]
    intent = {"schema": "upstate.scenario-footprint-install-intent/v1",
              "model_only": model_only, "registry_mode": registry_mode, "owned_files": owned_files,
              "files": [{"path": str(path.relative_to(application)), "bytes": len(body),
                         "sha256": sha(body),
                         "previous_sha256": sha(expected) if expected is not None else None}
                        for path, body, expected in pending]}
    intent_body = (json.dumps(intent, sort_keys=True, indent=2) + "\n").encode("utf-8")
    identity = sha(intent_body)
    for relative, body in originals.items():
        path = application / INSTALL_ROOT / identity / "preimage" / relative
        prior = path.read_bytes() if path.exists() else None
        if prior is not None and prior != body:
            raise ValueError("A retained installation predecessor differs")
        atomic(path, body, prior)
    intent_path = application / INSTALL_ROOT / identity / "intent.json"
    prior = intent_path.read_bytes() if intent_path.exists() else None
    if prior is not None and prior != intent_body:
        raise ValueError("A retained installation intent differs")
    atomic(intent_path, intent_body, prior)
    for path, body, expected in pending:
        atomic(path, body, expected)
    prior_owned = {}
    if current_before is not None:
        for row in json.loads(current_before).get("owned_files", []):
            if row.get("path") in FILES:
                prior_owned[row["path"]] = row
    prior_owned.update({row["path"]: row for row in owned_files})
    receipt = {"schema": "upstate.scenario-footprint-install/v1",
               "application": str(application), "preimage_id": identity,
               "opening_route": None if model_only else ("/#scenario-footprint" if registry_mode
                                                        else "/web/scenario-footprint.html"),
               "integration": "model-only" if model_only else ("registry" if registry_mode else "standalone"),
               "owned_files": list(prior_owned.values()),
               "files": [{"path": str(path.relative_to(application)), "bytes": len(body), "sha256": sha(body)}
                         for path, body, _ in pending]}
    atomic(current_path, (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode("utf-8"),
           current_before)
    print(json.dumps(receipt, indent=2))
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source", help="Received complete component root")
    parser.add_argument("--model-only", action="store_true",
                        help="Install native seams when the receiving operator already registers the supplied provider")
    args = parser.parse_args(argv)
    install(args.application, args.source, model_only=args.model_only)


if __name__ == "__main__":
    main()

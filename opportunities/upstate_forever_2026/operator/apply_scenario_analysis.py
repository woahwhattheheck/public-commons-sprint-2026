"""Install scenario analysis into the current shared Upper Savannah application."""
from __future__ import annotations

import argparse
import ast
import base64
import binascii
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import runpy
import tempfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source_packet(value):
    """Decode a verified standard source bank or retain an original plaintext packet."""
    if not isinstance(value, dict):
        raise ValueError("Use an original source packet or a complete source-bank object")
    if value.get("schema") != "commons.source-bank/v1":
        if not isinstance(value.get("files"), dict):
            raise ValueError("The original source packet must contain a files dictionary")
        return value

    metadata = value.get("installer_packet")
    if not isinstance(metadata, dict) or not isinstance(value.get("files"), list):
        raise ValueError("The source bank must include its complete installer metadata and files")
    packet = dict(metadata)
    if value.get("source_root") != packet.get("prefix"):
        raise ValueError("The source bank and installer target different application roots")
    if not isinstance(packet.get("prefix"), str) or not packet["prefix"]:
        raise ValueError("The installer application prefix is missing")

    bodies, file_metadata = {}, {}
    for item in value["files"]:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("Each source-bank file needs an original relative path")
        name = item["path"]
        relative = PurePosixPath(name)
        if (not name or relative.is_absolute() or ".." in relative.parts
                or "\\" in name or str(relative) != name or name in bodies):
            raise ValueError("Invalid or duplicate source path: " + name)
        try:
            data = base64.b64decode(item["content_base64"], validate=True)
        except (KeyError, TypeError, ValueError, binascii.Error) as error:
            raise ValueError("Invalid base64 source: " + name) from error
        if (type(item.get("bytes")) is not int or len(data) != item["bytes"]
                or sha(data) != item.get("sha256")):
            raise ValueError("Source bytes or SHA256 differ: " + name)
        if item.get("mode") not in ("100644", "100755"):
            raise ValueError("Use a regular source-file Git mode: " + name)
        try:
            bodies[name] = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("Source is not UTF-8: " + name) from error
        file_metadata[name] = {key: item[key] for key in ("bytes", "sha256", "mode")}
    if not bodies:
        raise ValueError("The complete source bank has no files")

    required = {"operator/apply_scenario_analysis.py",
                "operator/web/scenario_analysis.mjs",
                "model/scenario_analysis.py"}
    required.update(packet.get("registry_files", []))
    if not required <= set(bodies):
        raise ValueError("Use the complete scenario source bank, including its runtime and registration")

    history = value.get("predecessor_history", {})
    if not isinstance(history, dict) or any(
            not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries)
            for entries in history.values()):
        raise ValueError("Use the source bank's original predecessor metadata")
    packet.update(files=bodies, file_metadata=file_metadata,
                  predecessor_history=history)
    packet["operation_id"] = value.get("operation_id") or packet["operation_id"]
    return packet


def native_version_closure(packet):
    """Keep current component source independently installable without peer desks."""
    files = packet["files"]
    python = []
    browser = []
    for name, source in files.items():
        if name.endswith(".py") and name != "model/native_versions.py":
            tree = ast.parse(source, filename=name)
            if any(isinstance(node, ast.ImportFrom) and (
                    node.module == "native_versions" and node.level == 1 or
                    node.module == "model.native_versions" and node.level == 0)
                   for node in ast.walk(tree)):
                python.append(name)
        elif name.endswith(".mjs") and name != "operator/web/native_versions.mjs":
            if re.search(r"""(?m)^\s*import\s+[^;\n]*?\bfrom\s*['"]\./native_versions\.mjs['"]""", source):
                browser.append(name)
    for dependency, consumers in (("model/native_versions.py", python),
                                  ("operator/web/native_versions.mjs", browser)):
        if consumers and dependency not in files:
            raise ValueError("The complete current component needs " + dependency +
                             "; imported by " + ", ".join(sorted(consumers)))
    for name, source in files.items():
        if not name.startswith("operator/extensions/") or not name.endswith(".json"):
            continue
        descriptor = json.loads(source)
        assets = descriptor.get("assets", [])
        consumers = [asset for asset in assets if "operator/web/" + asset in browser]
        if consumers and "native_versions.mjs" not in assets:
            raise ValueError("The current component must declare native_versions.mjs in " + name)


def apply(root, packet, integration="auto"):
    packet = source_packet(packet)
    native_version_closure(packet)
    root = Path(root).resolve(strict=True)
    prefix = packet["prefix"].rstrip("/") + "/"
    application = root if (root / "model" / "workspace.py").is_file() else root / packet["prefix"]
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Receive the complete original application before installing this extension")

    def target(name):
        path = application / name[len(prefix):] if name.startswith(prefix) else root / name
        if not path.resolve().is_relative_to(root):
            raise ValueError("Source path leaves the selected checkout: " + name)
        return path

    server = (application / "operator/server.py").read_text(encoding="utf-8")
    app = (application / "operator/web/app.mjs").read_text(encoding="utf-8")
    ready = "self.extensions = ExtensionRegistry(" in server and "const extensions=createExtensionHost(" in app
    if integration == "auto":
        integration = "extensions" if ready else "legacy"
    if integration == "extensions" and not ready:
        raise ValueError("Install the shared host first: python -B install_extensions.py "
                         "--application CURRENT_APP --source-root COMPLETE_SOURCE")

    changes, original = {}, {}
    registry_files = set(packet.get("registry_files", []))

    def current(path):
        if path not in original:
            original[path] = path.read_bytes() if path.exists() else None
        return changes.get(path, original[path])

    def allowed_predecessor(name, data):
        candidates = [packet.get(key, {}).get(name)
                      for key in ("previous_file_metadata", "historical_file_metadata")]
        candidates.extend(packet.get("predecessor_history", {}).get(name, []))
        return any(isinstance(previous, dict) and len(data) == previous.get("bytes")
                   and sha(data) == previous.get("sha256") for previous in candidates)

    for name, body in packet["files"].items():
        if integration == "legacy" and name in registry_files:
            # The legacy joins retain this desk's action ownership. The complete
            # source carrier still contains the later extension-host bindings.
            continue
        path = target(prefix + name)
        content = body.encode("utf-8")
        before = current(path)
        if before == content:
            continue
        if before is not None and not allowed_predecessor(name, before):
            raise ValueError("Merge the current authored source before replacing " + str(path))
        changes[path] = content

    if integration == "extensions":
        # Migrate only our own exact prior joins. Peer source outside these
        # unique spans remains unchanged, including the shared extension host.
        seen = set()
        for entry in list(packet.get("previous_operator_edits", [])) + packet["operator_edits"]:
            pair = (entry["path"], entry["old"], entry["new"])
            if pair in seen:
                continue
            seen.add(pair)
            path = target(entry["path"])
            body = current(path).decode("utf-8")
            if entry["new"] in body:
                if body.count(entry["new"]) != 1:
                    raise ValueError("Scenario join is ambiguous in " + str(path))
                changes[path] = body.replace(entry["new"], entry["old"], 1).encode("utf-8")
        migrated_server = current(application / "operator/server.py").decode("utf-8")
        migrated_app = current(application / "operator/web/app.mjs").decode("utf-8")
        migrated_workspace = current(application / "model/workspace.py").decode("utf-8")
        if ('ACTIONS.add("scenario.analyze")' in migrated_server
                or 'const scenarioAnalysis=' in migrated_app):
            raise ValueError("Compose the remaining scenario-specific legacy joins with the installed extension host")
        if '"scenario_analyses":' in migrated_workspace:
            descriptor = json.loads(current(application / "operator/extensions/scenario-analysis.json"))
            state = descriptor.get("backend", {}).get("state", {})
            registry = current(application / "operator/extension_registry.py").decode("utf-8")
            if state.get("when_missing") is not True or "state_when_missing" not in registry:
                raise ValueError("Receive the matching conditional scenario state descriptor and extension registry before installing into the native projected Workspace")
    else:
        manifest = application / "operator/extensions/scenario-analysis.json"
        if manifest.exists():
            before = current(manifest)
            expected = packet["files"].get("operator/extensions/scenario-analysis.json", "").encode("utf-8")
            if before != expected and not allowed_predecessor("operator/extensions/scenario-analysis.json", before):
                raise ValueError("The installed scenario manifest differs; retain and reconcile its source")
            # Remove only our exact inactive registration when using explicit
            # legacy ownership. The carrier preserves the complete registration.
            changes[manifest] = None
        for entry in packet["operator_edits"]:
            path = target(entry["path"])
            body = current(path).decode("utf-8")
            old, new = entry["old"], entry["new"]
            if new in body:
                continue
            # V1 installed the same stylesheet beside reviews.css. Preserve
            # that working placement when upgrading the source module.
            if (entry["path"].endswith("/index.html") and
                    '<link rel="stylesheet" href="/web/scenario_analysis.css">' in body
                    and '<link rel="stylesheet" href="/web/scenario_analysis.css">' in new):
                continue
            if body.count(old) != 1:
                raise ValueError("Compose this scenario edit against current source: " + entry["path"])
            changes[path] = body.replace(old, new, 1).encode("utf-8")

    if integration == "legacy" and "operator/web/native_versions.mjs" in packet["files"]:
        # Legacy operators use an explicit static allowlist rather than assets
        # from extension descriptors. Extend only that original literal.
        path = application / "operator/server.py"
        body = current(path).decode("utf-8")
        matches = list(re.finditer(r"if selected not in (\{[^{}\n]*\}):", body))
        if len(matches) != 1:
            raise ValueError("Compose the original static asset allowlist with native_versions.mjs")
        match = matches[0]
        assets = ast.literal_eval(match.group(1))
        if (not isinstance(assets, set) or not all(isinstance(name, str) for name in assets)
                or not {"index.html", "app.mjs", "style.css"} <= assets):
            raise ValueError("The original static asset allowlist differs; preserve its current source")
        if "native_versions.mjs" not in assets:
            literal = match.group(1)[:-1].rstrip().rstrip(",") + ', "native_versions.mjs"}'
            changes[path] = (body[:match.start(1)] + literal + body[match.end(1):]).encode("utf-8")

    for path, body in changes.items():
        if body is not None and path.suffix == ".py":
            ast.parse(body.decode("utf-8"), filename=str(path))
        if body is not None and path.suffix == ".json":
            json.loads(body)
    for path in changes:
        if (path.read_bytes() if path.exists() else None) != original[path]:
            raise ValueError("Concurrent source change: " + str(path))

    applied = []
    for path, body in changes.items():
        before = original[path]
        if body == before:
            continue
        if (path.read_bytes() if path.exists() else None) != before:
            raise ValueError("Concurrent source change: " + str(path))
        if body is None:
            path.unlink()
            applied.append({"path": str(path.relative_to(root)), "removed": True})
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix="."+path.name+".", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, (path.stat().st_mode & 0o777) if before is not None else 0o644)
        try:
            if (path.read_bytes() if path.exists() else None) != before:
                raise ValueError("Concurrent source change: " + str(path))
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
        applied.append({"path": str(path.relative_to(root)), "sha256": sha(body), "bytes": len(body)})
    return {"operation_id": packet["operation_id"], "integration": integration, "changed": applied}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="Existing checkout or Upper Savannah application directory")
    carrier = parser.add_mutually_exclusive_group(required=True)
    carrier.add_argument("--bundle", help="Complete commons.source-bank/v1 JSON or decoded original source packet")
    carrier.add_argument("--carrier", help="Saved complete source Canvas Markdown, JSON or JSON.gz")
    parser.add_argument("--receiver", help="Original receive_application_source.py, required with --carrier")
    parser.add_argument("--integration", choices=("auto", "extensions", "legacy"), default="auto")
    args = parser.parse_args()
    try:
        if args.carrier:
            if not args.receiver:
                raise ValueError("Use --receiver with --carrier to verify and decode the source")
            receiver = runpy.run_path(str(Path(args.receiver).resolve(strict=True)))
            packet, _files, _receipt = receiver["read_carrier"](Path(args.carrier))
        else:
            packet = json.loads(Path(args.bundle).read_text(encoding="utf-8-sig"))
        result = apply(args.root, packet, args.integration)
    except (OSError, ValueError, KeyError, TypeError, SyntaxError) as error:
        parser.exit(2, "scenario operator integration: " + str(error) + "\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

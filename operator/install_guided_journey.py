#!/usr/bin/env python3
"""Install the guided journey in the complete, registered Upper Savannah operator."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone

SCHEMA = "upstate.guided-journey-component/v1"
MANIFEST = "operator/Guided_Journey_Source.json"
OWNED = frozenset({
    "operator/install_guided_journey.py",
    "operator/Guided_Journey_Integration.json",
    "operator/extensions/guided-journey.json",
    "operator/web/journey.mjs",
    "operator/web/journey.css",
    "operator/GUIDED_JOURNEY.md",
    MANIFEST,
})
PREDECESSORS = {
    "operator/install_guided_journey.py": "d26ec75243ac872e62ee546173a41caaecb66dff931714eb2138a940e86a01cf",
    "operator/Guided_Journey_Integration.json": "6e65a9f432d86b16176161a47c15455f79354da5604cafcf100d5ad6c5ca103b",
    "operator/extensions/guided-journey.json": "081005d323f5c521227f030fbaa5795d2b965591b3c0a071e7ac361df939644d",
    "operator/web/journey.mjs": "6597690150bd4ebedb43a94469d404bd7ce9fc73acfc721d6b7ef6644ae9995e",
    "operator/web/journey.css": "61952e1dbaf7340f0a43e2fa45df33f12a8d82f5a684fabe178bffab78903e5a",
    "operator/GUIDED_JOURNEY.md": "76235bf1375bc11ab96f52dbb165a63c0bd15881344f82fc829fb02e6387e013",
    "operator/Guided_Journey_Source.json": "778c3a9ee83be0640326b555450b5da7c864d61e40de6c09107110286cb8f566"
}
# Exact maintained source edition accepted beside the original predecessor.
CURRENT_PREDECESSORS = {
    "operator/install_guided_journey.py": "9f48a87fa421dcc1340f889aedc6c5ca7c02622dec033426fdad2729c8ef8fb9",
    "operator/Guided_Journey_Integration.json": "6e65a9f432d86b16176161a47c15455f79354da5604cafcf100d5ad6c5ca103b",
    "operator/extensions/guided-journey.json": "2755b6dcd057097d980d85fa186fdc7d560a8bcf45678d56052bb9fe7f448734",
    "operator/web/journey.mjs": "50104cfae414b8cb68fc8d380f7f7898939b376fa761a48969efba148c45c059",
    "operator/web/journey.css": "61952e1dbaf7340f0a43e2fa45df33f12a8d82f5a684fabe178bffab78903e5a",
    "operator/GUIDED_JOURNEY.md": "3a7dc94ad9e9cf575e21b71d4d07e53d6594e9fe24ec22ae70327d3d70d70ae5",
    "operator/Guided_Journey_Source.json": "fa263a69cf8b0e5590bfcbef01d37a27c4dd20d07e813f55847ed6e623147aa2"
}
SHARED = ("operator/server.py", "operator/web/app.mjs")
OPTIONAL_SHARED = ("install_extensions.py", "operator/web/index.html")


def now():
    return datetime.now(timezone.utc).isoformat()


def pin(body):
    return {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


def safe_path(root, name):
    if name not in OWNED and name not in SHARED and name not in OPTIONAL_SHARED:
        raise ValueError("Unexpected source path: " + name)
    path = root / name
    if not path.parent.resolve().is_relative_to(root) or path.is_symlink():
        raise ValueError("Source path leaves the selected application: " + name)
    if path.exists() and not path.is_file():
        raise ValueError("Source path is not an ordinary file: " + name)
    return path


def read(path):
    return path.read_bytes() if path.exists() else None


def atomic(path, body, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".guided-journey-", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def read_component(source):
    source = source.resolve(strict=True)
    manifest_body = safe_path(source, MANIFEST).read_bytes()
    manifest = json.loads(manifest_body)
    if manifest.get("schema") != SCHEMA or manifest.get("edition") != 2:
        raise ValueError("Select the complete registered guided journey component, edition 2")
    records = manifest.get("files", {})
    if set(records) != OWNED - {MANIFEST}:
        raise ValueError("The component must contain all seven complete source files")
    files = {MANIFEST: manifest_body}
    for name, expected in records.items():
        body = safe_path(source, name).read_bytes()
        if pin(body) != expected:
            raise ValueError("Component source differs from its declared identity: " + name)
        files[name] = body
    integration = json.loads(files["operator/Guided_Journey_Integration.json"])
    if integration.get("schema") != "upstate.guided-journey-integration/v1" or integration.get("edition") != 2:
        raise ValueError("Select the current registered integration declaration")
    return manifest, files, integration


def patch_text(text, patches):
    # Keep the application's exact maintained postimage when an explicitly
    # declared compatible source form is already present.
    selected = []
    for original in patches:
        patch = dict(original)
        present = [variant for variant in patch.get("compatible_after", [])
                   if variant["after"] in text]
        if len(present) > 1:
            raise ValueError("Ambiguous compatible source join: " + patch["id"])
        if present:
            # A compatible complete form may retain the original marker.
            # Reject another occurrence outside that exact selected form.
            remaining = text.replace(present[0]["after"], "", 1)
            if patch["after"] in remaining or patch["marker"] in remaining:
                raise ValueError("Multiple current source forms at: " + patch["id"])
            patch.update(present[0])
        elif patch["after"] not in text:
            previous = [variant for variant in patch.get("compatible_before", [])
                        if variant["before"] in text]
            if len(previous) > 1:
                raise ValueError("Ambiguous previous source join: " + patch["id"])
            if previous:
                patch.update(previous[0])
        selected.append(patch)
    patches = selected
    for patch in patches:
        before, after, marker = patch["before"], patch["after"], patch["marker"]
        if after in text:
            if text.count(after) != 1 or text.count(marker) != 1:
                raise ValueError("Ambiguous complete source join: " + patch["id"])
            continue
        if marker in text:
            raise ValueError("The existing source join is incomplete or changed: " + patch["id"])
        if text.count(before) != 1:
            raise ValueError("Compose the current complete application at " + patch["id"] +
                             ": expected one original source anchor, found " + str(text.count(before)))
        text = text.replace(before, after, 1)
    # Every declared postimage must survive the complete composition.
    for patch in patches:
        if text.count(patch["after"]) != 1 or text.count(patch["marker"]) != 1:
            raise ValueError("A later source edit overlaps the completed join: " + patch["id"])
    return text


def parse_source(files, node):
    for name, body in files.items():
        if name.endswith(".py"):
            compile(body, name, "exec")
        elif name.endswith(".json"):
            json.loads(body)
        elif name.endswith(".mjs"):
            subprocess.run([node, "--input-type=module", "--check"],
                           input=body, check=True, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE)


def prepare(application, files, integration):
    original, proposed, modes = {}, {}, {}
    for name, incoming in files.items():
        path = safe_path(application, name)
        before = read(path)
        if (before is not None and before != incoming
                and hashlib.sha256(before).hexdigest() not in {PREDECESSORS.get(name), CURRENT_PREDECESSORS.get(name)}):
            raise ValueError("Preserve and compose the other installed journey edition at " + name)
        original[name], proposed[name] = before, incoming
        modes[name] = path.stat().st_mode & 0o777 if before is not None else 0o644
    community = application / "operator/web/community.mjs"
    if not community.is_file():
        raise ValueError("Receive the current Community controller with this guided journey.")
    community_source = community.read_text(encoding="utf-8")
    for capability in ("export function validateCommunityView(", "function capture(",
                       "function validateView(", "function restoreView("):
        if capability not in community_source:
            raise ValueError("Receive the current Community view source before installing this journey: " + capability)
    app = safe_path(application, "operator/web/app.mjs").read_text()
    server = safe_path(application, "operator/server.py").read_text()
    if "const extensions=createExtensionHost(" not in app or "extensions.update(state)" not in app:
        raise ValueError("Install the current complete extension component with install_extensions.py first")
    if "self.extensions = ExtensionRegistry(" not in server or "self.app.extensions.web_assets" not in server:
        raise ValueError("Receive the current original authenticated extension registry first")
    selected = {
        "operator/web/app.mjs": integration["patches"],
        "operator/server.py": integration["server_patches"],
    }
    for name, patches in integration.get("optional_file_patches", {}).items():
        if safe_path(application, name).exists():
            selected[name] = patches
    for name, patches in selected.items():
        path = safe_path(application, name)
        before = path.read_bytes()
        original[name] = before
        modes[name] = path.stat().st_mode & 0o777
        proposed[name] = patch_text(before.decode("utf-8"), patches).encode()
    return original, proposed, modes


def current_files(application, names):
    return {name: read(safe_path(application, name)) for name in names}


def describe(original, proposed, modes):
    return {name: {"before": pin(original[name]) if original[name] is not None else None,
                   "after": pin(body), "mode": modes[name]}
            for name, body in proposed.items()}


def bank_body(path, body):
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("A frozen source body already differs at " + str(path))
    else:
        atomic(path, body)


def restore_intent(directory, intent, files, application):
    if intent.get("application") != str(application) or intent.get("source_manifest") != pin(files[MANIFEST]):
        raise ValueError("The saved source installation belongs to a different application or component")
    names = set(intent.get("files", {}))
    allowed = OWNED | set(SHARED) | set(OPTIONAL_SHARED)
    if not (OWNED | set(SHARED)) <= names or not names <= allowed:
        raise ValueError("The frozen source installation has an incomplete file set")
    original, proposed, modes = {}, {}, {}
    for name, record in intent["files"].items():
        safe_path(application, name)
        before = (directory / "before" / name).read_bytes() if record["before"] is not None else None
        after = (directory / "after" / name).read_bytes()
        if (pin(before) if before is not None else None) != record["before"] or pin(after) != record["after"]:
            raise ValueError("A frozen source body changed: " + name)
        if name in files and after != files[name]:
            raise ValueError("The supplied component differs from this existing source operation: " + name)
        original[name], proposed[name], modes[name] = before, after, record["mode"]
    return original, proposed, modes


def installed_compatible(application, files, integration, node):
    if any(read(safe_path(application, name)) != body for name, body in files.items()):
        return None
    original, proposed, modes = prepare(application, files, integration)
    if any(original[name] != body for name, body in proposed.items()):
        return None
    parse_source(proposed, node)
    if current_files(application, proposed) != proposed:
        raise ValueError("Current source changed during installed-component readback")
    return describe(original, proposed, modes)


def rollback(application, attempted, original, proposed, modes):
    disposition = {}
    for name in reversed(attempted):
        try:
            path = safe_path(application, name)
            current = read(path)
            if current == proposed[name]:
                if original[name] is None:
                    path.unlink()
                else:
                    atomic(path, original[name], modes[name])
            current = read(path)
            disposition[name] = "restored" if current == original[name] else "concurrent_source_preserved"
        except BaseException as error:
            try:
                current = read(path)
                disposition[name] = "restored" if current == original[name] else "recovery_required: " + str(error)
            except BaseException as read_error:
                disposition[name] = "readback_required: " + str(read_error)
    return disposition


def install(application, source, node, check_only=False):
    application = application.resolve(strict=True)
    if not (application / "model/workspace.py").is_file():
        raise ValueError("Select the complete current Upper Savannah application")
    node = shutil.which(node)
    if not node:
        raise ValueError("Use the installed Node executable to parse the original browser source")
    manifest, files, integration = read_component(source)
    bank = application.parent / ".upstate-guided-journey-install" / application.name
    directory = bank / pin(files[MANIFEST])["sha256"]
    receipt = directory / "intent.json"
    if check_only:
        if receipt.exists():
            intent = json.loads(receipt.read_bytes())
            original, proposed, modes = restore_intent(directory, intent, files, application)
            current = current_files(application, proposed)
            if any(current[name] not in (original[name], proposed[name]) for name in current):
                compatible = installed_compatible(application, files, integration, node)
                if compatible is None:
                    raise ValueError("Current concurrent source needs composition before this operation continues")
                return {"state": "checked_installed", "application": str(application),
                        "intent": str(receipt), "files": compatible}
        else:
            original, proposed, modes = prepare(application, files, integration)
            current = original
        parse_source(proposed, node)
        if current_files(application, proposed) != current:
            raise ValueError("The current application changed during source preparation")
        return {"schema": "upstate.guided-journey-install/v1", "state": "checked",
                "operation_id": manifest["operation_id"], "application": str(application),
                "files": describe(original, proposed, modes)}

    bank.mkdir(parents=True, exist_ok=True)
    with (bank / "source.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if receipt.exists():
            intent = json.loads(receipt.read_bytes())
            original, proposed, modes = restore_intent(directory, intent, files, application)
            current = current_files(application, proposed)
            if any(current[name] not in (original[name], proposed[name]) for name in current):
                compatible = installed_compatible(application, files, integration, node)
                if compatible is None:
                    raise ValueError("Concurrent source is preserved; compose it with this frozen source operation")
                record = {"schema": "upstate.guided-journey-install-attempt/v1",
                          "attempt_id": uuid.uuid4().hex, "state": "already_installed",
                          "intent": str(receipt), "observed_at": now(), "current_files": compatible}
                atomic(directory / "attempts" / (record["attempt_id"] + ".json"), json_bytes(record))
                return record
        else:
            original, proposed, modes = prepare(application, files, integration)
            current = original
            parse_source(proposed, node)
            if current_files(application, proposed) != current:
                raise ValueError("The application changed while preparing this complete source operation")
            intent = {"schema": "upstate.guided-journey-install/v1",
                      "operation_id": manifest["operation_id"], "application": str(application),
                      "source_manifest": pin(files[MANIFEST]), "created_at": now(),
                      "files": describe(original, proposed, modes)}
            directory.mkdir(parents=True, exist_ok=True)
            for name, body in proposed.items():
                if original[name] is not None:
                    bank_body(directory / "before" / name, original[name])
                bank_body(directory / "after" / name, body)
            # The first complete intent and source bodies remain unchanged on retries.
            bank_body(receipt, json_bytes(intent))
        parse_source(proposed, node)
        for name, body in current.items():
            if body not in (original[name], proposed[name]):
                raise ValueError("Concurrent source is preserved at " + name)
        record = {"schema": "upstate.guided-journey-install-attempt/v1",
                  "attempt_id": uuid.uuid4().hex, "intent": str(receipt), "started_at": now(),
                  "state": "prepared", "files_to_install": [name for name in proposed if current[name] != proposed[name]]}
        attempt_path = directory / "attempts" / (record["attempt_id"] + ".json")
        atomic(attempt_path, json_bytes(record))
        order = [name for name in files if current[name] != proposed[name]]
        order += [name for name in proposed if name not in files and current[name] != proposed[name]]
        attempted = []
        try:
            for name in order:
                path = safe_path(application, name)
                if read(path) != current[name]:
                    raise ValueError("Concurrent source edit preserved at " + name)
                # Record the candidate before atomic(): replace may succeed before fsync raises.
                attempted.append(name)
                atomic(path, proposed[name], modes[name])
                if path.read_bytes() != proposed[name]:
                    raise OSError("Installed source readback differs: " + name)
            if current_files(application, proposed) != proposed:
                raise OSError("The current source changed before final readback")
        except BaseException as error:
            record["rollback"] = rollback(application, attempted, original, proposed, modes)
            record["remaining_files"] = {}
            for name in proposed:
                try:
                    remaining = read(safe_path(application, name))
                    if remaining != original[name]:
                        record["remaining_files"][name] = "installed" if remaining == proposed[name] else "concurrent_source_preserved"
                except BaseException as read_error:
                    record["remaining_files"][name] = "readback_required: " + str(read_error)
            record["state"] = ("rolled_back" if not record["remaining_files"] else
                               "partially_installed" if all(value == "installed" for value in record["remaining_files"].values()) else
                               "recovery_required")
            record["error"] = str(error)
            record["ended_at"] = now()
            try:
                atomic(attempt_path, json_bytes(record))
            except BaseException:
                pass
            raise
        record.update(state="installed" if order else "already_installed", ended_at=now(),
                      opening_route="Open the existing operator and choose Guided journey.",
                      installed_files={name: pin(body) for name, body in proposed.items()})
        atomic(attempt_path, json_bytes(record))
        return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--node", default="node")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        result = install(args.application, args.source_root, args.node, args.check)
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.stderr.decode(errors="replace") if error.stderr else str(error))
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

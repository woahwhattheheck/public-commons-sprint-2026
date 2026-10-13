#!/usr/bin/env python3
"""Install the cumulative Upper Savannah source in a fresh application directory.

Uses the retained component authors' source transformations, composes their shared
lifecycle hooks, restores bundled original input bytes, and publishes one complete
application ZIP. Run with the existing scientific Python environment.
"""
from __future__ import annotations

import argparse
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import traceback
import zipfile

OPERATION = "UPSTATE-INTEGRATED-DELIVERY-ECD1-20261012"
RECORD = "CUMULATIVE_INSTALLATION.json"
SHARED = ("operator/server.py", "operator/web/app.mjs",
          "operator/web/index.html", "model/portable.py")


def sha(body):
    return hashlib.sha256(body).hexdigest()


def replace(text, before, after, label):
    if after in text and (before in after or before not in text):
        return text
    if not before or text.count(before) != 1:
        raise ValueError(label + ": expected one current source anchor")
    return text.replace(before, after, 1)


def owned_inventory(root):
    entries = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(p in {"__pycache__", ".git", ".venv", "venv", "node_modules"} for p in relative.parts):
            continue
        if any(p.startswith(".") for p in relative.parts) or path.suffix in {".pyc", ".pyo", ".lock"}:
            continue
        if relative.as_posix() in {"APPLICATION_SOURCE_RECEIPT.json", RECORD}:
            continue
        if path.is_symlink():
            raise ValueError("Application source contains a file alias: " + str(relative))
        if path.is_file():
            body = path.read_bytes()
            entries[relative.as_posix()] = {
                "bytes": len(body), "sha256": sha(body),
                "mode": "100755" if path.stat().st_mode & 0o111 else "100644",
            }
    return entries


def identity(entries):
    return sha((json.dumps(entries, sort_keys=True, separators=(",", ":")) + "\n").encode())


def write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body.encode("utf-8") if isinstance(body, str) else body)


def module(root, name):
    return runpy.run_path(str(root / name), run_name="_cumulative_" + name.replace("/", "_").replace(".", "_"))


def apply_function(root, transforms, label, records):
    changes = []
    pending = {}
    for relative, function in transforms:
        original = (root / relative).read_text("utf-8")
        result = function(original)
        if relative.endswith(".py"):
            ast.parse(result, filename=relative)
        if result != original:
            pending[relative] = result
            changes.append({"path": relative, "before": sha(original.encode()),
                            "after": sha(result.encode())})
    for relative, result in pending.items():
        write(root / relative, result)
    records.append({"component": label, "changes": changes})


def diagnostic_join(root, records):
    package = module(root, "operator/install_diagnostics.py")
    pending, changes = {}, []
    for item in package["PATCHES"]:
        path = item["path"]
        text = pending.setdefault(path, (root / path).read_text("utf-8"))
        before, after = item["anchor"], item["replacement"]
        if item["key"] == "app-workspace-detach":
            # Earlier scenario-analysis registration owns its own detach call.
            # Insert this controller at the original workspace assignment.
            before, after = "workspace=id;", "experimentDiagnostics.detach();workspace=id;"
        result = replace(text, before, after, "Scientific interpretation " + item["key"])
        pending[path] = result
        if result != text:
            changes.append(item["key"])
    for path, text in pending.items():
        if path.endswith(".py"):
            ast.parse(text, filename=path)
    for path, text in pending.items():
        write(root / path, text)
    records.append({"component": "Scientific interpretation", "joins": changes})


def restore_inputs(root):
    path = root / "integration/source_binary_inputs.json"
    if not path.exists():
        return []
    bank = json.loads(path.read_text("utf-8"))
    if bank.get("schema") != "commons.embedded-source-inputs/v1":
        raise ValueError("Choose the complete retained source input bank")
    from source_tools.application_assembly import member_name
    restored = []
    for item in bank["files"]:
        name = member_name(item["path"])
        data = base64.b64decode(item["content_base64"], validate=True)
        if len(data) != item["bytes"] or sha(data) != item["sha256"]:
            raise ValueError("Retained input identity differs: " + str(name))
        target = root.joinpath(*name.parts)
        if target.exists() and target.read_bytes() != data:
            raise ValueError("Another original input owns " + str(name))
        write(target, data)
        restored.append({"path": str(name), "bytes": len(data), "sha256": sha(data)})
    return restored


def shared_lifecycle(root):
    path = root / "operator/web/app.mjs"
    text = path.read_text("utf-8")
    controllers = [
        ("experiments", "experiments"), ("conservation", "conservation"),
        ("experimentDiagnostics", "experiment-diagnostics"),
        ("chemistry", "chemistry"), ("programmes", "programmes"),
    ]
    installed = [(name, view) for name, view in controllers
                 if ("const " + name + "=") in text or ("const " + name + " =") in text]
    lines = ["  // Cumulative lifecycle: detach only desks outside the selected view."]
    lines += ["  if(view!==" + json.dumps(view) + ")" + name + ".detach();"
              for name, view in installed]
    if "const extensions=" in text or "const extensions =" in text:
        lines.append("  if(!extensions.hasView(view))extensions.detach();")
    addition = "\n".join(lines) + "\n"
    anchor = "function render(){\n  if(!state)return;\n"
    text = replace(text, anchor, anchor + addition, "complete desk view lifecycle")
    guard = " if(formDialog.open)throw Error('Finish or close the current draft before changing workspaces.');\n"
    cleanup = "".join(" " + name + ".detach();\n" for name, _ in installed)
    text = text.replace("async function selectWorkspace(id){\n conservation.detach();\n",
                        "async function selectWorkspace(id){\n", 1)
    text = replace(text, guard, guard + cleanup, "desk lifecycle after original draft guard")
    # The shared-host installer has emitted both authored fallback spellings.
    # Normalize the older fallback before accepting the current one on replay.
    old_confirmation = "toast((actionLabels[action]||action)+' retained.');"
    confirmation = "toast((actionLabels[action] || action)+' retained.');"
    if old_confirmation in text:
        text = replace(text, old_confirmation, confirmation,
                       "registered action completion label")
    else:
        text = replace(text, "toast(actionLabels[action]+' retained.');",
                       confirmation, "registered action completion label")
    write(path, text)

    index = root / "operator/web/index.html"
    html = index.read_text("utf-8")
    if any(view == "chemistry" for _, view in installed) and 'data-view="chemistry"' not in html:
        anchor = '    <button data-view="observations">'
        html = replace(html, anchor,
                       '    <button data-view="chemistry">Reach chemistry</button>\n' + anchor,
                       "Reach chemistry navigation")
    write(index, html)


def compose(root, records=None):
    if records is None:
        records = []
    diagnostic_join(root, records)
    experiments = module(root, "install_experiments.py")
    apply_function(root, [
        ("operator/server.py", experiments["server_join"]),
        ("operator/web/app.mjs", experiments["app_join"]),
        ("operator/web/index.html", experiments["index_join"]),
        ("model/portable.py", experiments["portable_join"]),
    ], "Scenario experiments", records)
    conservation = module(root, "operator/install_conservation.py")
    apply_function(root, [
        ("operator/server.py", conservation["patch_server"]),
        ("operator/web/app.mjs", conservation["patch_app"]),
        ("operator/web/index.html", conservation["patch_index"]),
    ], "Conservation plans", records)
    if (root / "install_chemistry.py").is_file():
        chemistry = module(root, "install_chemistry.py")
        apply_function(root, [
            ("operator/server.py", chemistry["patch_server"]),
            ("operator/web/app.mjs", chemistry["patch_app"]),
            ("operator/web/index.html", chemistry["patch_index"]),
        ], "Reach chemistry", records)
    if (root / "install_programmes.py").is_file():
        programmes = module(root, "install_programmes.py")
        apply_function(root, [
            ("operator/server.py", programmes["patch_server"]),
            ("operator/web/app.mjs", programmes["patch_app"]),
            ("operator/web/index.html", programmes["patch_index"]),
        ], "Saved programmes", records)
    extensions = module(root, "install_extensions.py")
    apply_function(root, [
        ("operator/server.py", extensions["patch_server"]),
        ("operator/web/app.mjs", extensions["patch_app"]),
    ], "Shared typed extension host", records)
    if (root / "operator/scenario_decision_install.py").is_file():
        result = module(root, "operator/scenario_decision_install.py")["integrate"](root)
        records.append({"component": "Saved watershed report previews", "result": result})
    shared_lifecycle(root)
    if (root / "operator/install_paired_ensemble.py").is_file():
        result = module(root, "operator/install_paired_ensemble.py")["install"](root / "operator")
        records.append({"component": "Namespaced paired ensembles", "result": result})
    if (root / "install_source_refresh.py").is_file():
        refresh = module(root, "install_source_refresh.py")
        apply_function(root, [
            ("operator/server.py", refresh["compose_server"]),
            ("operator/web/index.html", refresh["compose_index"]),
        ], "Original-source refresh", records)
    guided_join(root, records)
    if (root / "source_tools/operator_session_composition.py").is_file():
        session = module(root, "source_tools/operator_session_composition.py")
        apply_function(root, [
            ("operator/server.py", session["patch_server"]),
            ("operator/web/app.mjs", session["patch_app"]),
            ("operator/web/index.html", session["patch_index"]),
            ("install_extensions.py", session["patch_extensions"]),
        ], "Native saved operating view and revision notes", records)
    if (root / "source_tools/investigations_composition.py").is_file():
        investigations = module(root, "source_tools/investigations_composition.py")
        apply_function(root, [
            ("operator/web/app.mjs", investigations["patch_app"]),
        ], "Native Investigations and scientific interpretation", records)
    registered_desks_join(root, records)
    return records


def registered_desks_join(root, records):
    """Apply each received component's maintained installer before source capture."""
    def complete(label, paths):
        present = [(root / name).is_file() for name in paths]
        if not any(present):
            return False
        missing = [name for name, exists in zip(paths, present) if not exists]
        if missing:
            raise ValueError(label + " source cohort is incomplete: " + ", ".join(missing))
        return True

    gis = ("install_gis_projects.py", "model/gis_project.py", "model/gis_workspace.py",
           "model/gis_project_cli.py", "model/gis_project_native.py",
           "model/gis_project_view.html", "model/GIS_PROJECTS.md",
           "model/requirements-gis.txt", "operator/gis_projects.py",
           "operator/web/gis-projects.mjs", "operator/web/gis-projects.css",
           "operator/extensions/gis-projects.json")
    if complete("Editable GIS projects", gis):
        result = module(root, gis[0])["install"](root, root)
        records.append({"component": "Editable GIS projects", "result": result})

    calibration = ("operator/install_calibration.py", "source_tools/calibration_assembly.py",
                   "model/calibration.py", "model/CALIBRATION.md",
                   "model/calibration_uncertainty.py", "model/CALIBRATION_UNCERTAINTY.md",
                   "model/calibration_maps.py", "model/CALIBRATION_MAPS.md",
                   "operator/calibration.py", "operator/CALIBRATION.md",
                   "operator/web/calibration.mjs", "operator/web/calibration_maps.mjs",
                   "operator/web/calibration.css", "operator/extensions/calibration.json")
    if complete("Calibration, source uncertainty and residual maps", calibration):
        result = module(root, calibration[0])["install"](root, root)
        records.append({"component": "Calibration, source uncertainty and residual maps",
                        "result": result})

    water = ("source_tools/install_water_context.py", "model/water_context.py",
             "model/WATER_CONTEXT.md", "operator/water_context_service.py",
             "operator/WATER_CONTEXT_SERVICE.md", "operator/web/water_context.mjs",
             "operator/web/water_context_map.mjs", "operator/web/water_context.css",
             "operator/extensions/water-context.json", "water_context_cli.py",
             "WATER_CONTEXT_OPERATOR.md")
    if complete("Water and Habitat Context", water):
        result = module(root, water[0])["install"](root)
        records.append({"component": "Water and Habitat Context", "result": result})

    parcels = ("operator/install_parcel_source_desk.py", "model/parcel_source_desk.py",
               "model/parcel_source_cli.py", "operator/parcel_source_desk.py",
               "operator/extensions/parcel-sources.json",
               "operator/web/parcel_source_desk.mjs", "operator/web/parcel_source_desk.css",
               "operator/parcel_source_receiving.py", "operator/PARCEL_SOURCE_DESK.md")
    if complete("Parcel Source Desk", parcels):
        result = module(root, parcels[0])["run"](root, root)
        records.append({"component": "Parcel Source Desk", "result": result})

    annual = ("operator/annual_reference.py", "operator/ANNUAL_REFERENCES.md",
              "operator/extensions/annual-reference.json",
              "operator/web/annual_reference.mjs", "operator/web/annual_reference.css",
              "source_tools/usgs_annual.py", "source_tools/USGS_ANNUAL.md",
              "source/usgs-annual2012-20261013/F7DN436B-original-metadata.xml")
    if complete("Original annual references", annual):
        descriptor = json.loads((root / annual[2]).read_text("utf-8"))
        if (descriptor.get("schema") != "upstate.operator-extension/v1"
                or descriptor.get("id") != "annual-reference"):
            raise ValueError("Select the original annual-reference descriptor")
        # The maintained registry discovers this received descriptor. Its provider
        # uses the original queue, SourcePreparation roots, uploads and file tickets.
        records.append({"component": "Original annual references",
                        "registration": "maintained extension registry",
                        "paths": list(annual)})


def guided_join(root, records):
    """Compose the author's full verified component in this fresh staging tree."""
    path = root / "operator/install_guided_journey.py"
    if not path.is_file():
        return
    package = module(root, "operator/install_guided_journey.py")
    manifest, files, integration = package["read_component"](root)
    original, proposed, modes = package["prepare"](root, files, integration)
    changes = []
    for name, body in proposed.items():
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        if name.endswith(".json"):
            json.loads(body)
        if original[name] != body:
            changes.append({"path": name,
                            "before": sha(original[name]) if original[name] is not None else None,
                            "after": sha(body)})
    for name, body in proposed.items():
        if original[name] != body:
            target = root / name
            write(target, body)
            target.chmod(modes[name])
    records.append({"component": "Guided journey",
                    "operation_id": manifest["operation_id"], "changes": changes})


def check_sources(root):
    python = 0
    for path in sorted(root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        ast.parse(path.read_text("utf-8"), filename=str(path.relative_to(root)))
        python += 1
    node = shutil.which("node")
    javascript = "browser receiving"
    if node:
        result = subprocess.run([node, "--check", str(root / "operator/web/app.mjs")],
                                capture_output=True, text=True, timeout=45)
        if result.returncode:
            raise ValueError(result.stderr.strip() or "Combined browser module did not parse")
        javascript = "combined operator module parsed"
    return {"python_modules": python, "javascript": javascript}


def archive_application(root, destination):
    destination = Path(destination).absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".application-", dir=destination.parent, delete=False) as stream:
            temporary = Path(stream.name)
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6, strict_timestamps=False) as archive:
            for path in sorted(root.rglob("*")):
                if path.is_file() and not path.is_symlink() and not any(
                        part.startswith(".") or part == "__pycache__"
                        for part in path.relative_to(root).parts):
                    archive.write(path, "upper-savannah-application/" + path.relative_to(root).as_posix())
        data = temporary.read_bytes()
        if destination.exists():
            # Compressed transport can differ across zlib versions. Existing
            # output is compared by its complete retained uncompressed members.
            with zipfile.ZipFile(destination) as current, zipfile.ZipFile(temporary) as proposed:
                if current.namelist() != proposed.namelist() or any(
                        current.read(name) != proposed.read(name) for name in current.namelist()):
                    raise ValueError("Another complete application owns " + str(destination))
            data = destination.read_bytes()
        else:
            os.link(temporary, destination)
        return {"path": str(destination), "bytes": len(data), "sha256": sha(data)}
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def install(source, output, archive):
    source, output = Path(source).resolve(strict=True), Path(output).absolute()
    if not (source / "model/workspace.py").is_file() or not (source / "operator/server.py").is_file():
        raise ValueError("Receive the complete source root before cumulative installation")
    if output == source or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError("Choose an independent receiving directory")
    original = owned_inventory(source)
    source_identity = identity(original)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        marker = json.loads((output / RECORD).read_text("utf-8"))
        if marker.get("source_sha256") != source_identity or marker.get("installed_files") != owned_inventory(output):
            raise ValueError("The existing receiving edition has different source; choose its own output directory")
        result = {"state": "current", "application": str(output), "source_sha256": source_identity}
        if archive:
            result["archive"] = archive_application(output, archive)
        return result
    staging = Path(tempfile.mkdtemp(prefix=".cumulative-application-", dir=output.parent))
    root = staging / "application"
    steps = []
    phase = "copy_source"
    completed = False
    try:
        shutil.copytree(source, root, ignore=shutil.ignore_patterns(
            "__pycache__", ".git", ".venv", "venv", "node_modules", "*.pyc", "*.pyo", "*.lock"))
        sys.path[:0] = [str(root / "operator"), str(root)]
        phase = "compose_application"
        compose(root, steps)
        phase = "restore_original_inputs"
        inputs = restore_inputs(root)
        phase = "check_application_sources"
        validation = check_sources(root)
        if owned_inventory(source) != original:
            raise ValueError("The retained input source changed during installation")
        record = {"schema": "upstate.cumulative-installation/v1", "operation_id": OPERATION,
                  "source_sha256": source_identity, "steps": steps, "restored_inputs": inputs,
                  "validation": validation, "installed_files": owned_inventory(root)}
        write(root / RECORD, json.dumps(record, ensure_ascii=False, indent=2) + "\n")
        phase = "publish_application"
        from source_tools.application_assembly import _rename_directory_new
        _rename_directory_new(root, output)
        completed = True
    except Exception as error:
        details = {"schema": "upstate.cumulative-installation-failure/v1",
                   "operation_id": OPERATION, "state": "error", "phase": phase,
                   "error": type(error).__name__, "message": str(error),
                   "source": str(source), "source_sha256": source_identity,
                   "requested_output": str(output),
                   "retained_stage": str(staging),
                   "retained_application": str(root) if root.is_dir() else None,
                   "completed_steps": steps, "traceback": traceback.format_exc()}
        try:
            retained = owned_inventory(root) if root.is_dir() else {}
            details["changed_files"] = [
                {"path": name, "before": original.get(name), "after": retained.get(name)}
                for name in sorted(original.keys() | retained.keys())
                if original.get(name) != retained.get(name)]
        except Exception as inspection_error:
            details["inventory_error"] = str(inspection_error)
        failure_path = staging / "CUMULATIVE_INSTALLATION_FAILURE.json"
        try:
            write(failure_path, json.dumps(details, ensure_ascii=False, indent=2) + "\n")
            details["failure_record"] = str(failure_path)
        except Exception as recording_error:
            details["recording_error"] = str(recording_error)
        failure = RuntimeError("Cumulative installation failed; staged source retained at " + str(staging))
        failure.receiving_details = details
        raise failure from error
    finally:
        # A failed attempt keeps its exact partial postimages and original source
        # for diagnosis. Only a successfully published staging directory is removed.
        if completed:
            shutil.rmtree(staging, ignore_errors=True)
    result = {"state": "installed", "application": str(output), "source_sha256": source_identity,
              "source_files": len(original), "installed_files": len(record["installed_files"]),
              "validation": validation, "entrypoint": str(output / "operator/server.py")}
    if archive:
        result["archive"] = archive_application(output, archive)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(install(args.source, args.output, args.archive), indent=2, ensure_ascii=False))
        return 0
    except Exception as error:
        details = getattr(error, "receiving_details", None)
        if details is None:
            details = {"state": "error", "error": type(error).__name__,
                       "message": str(error), "traceback": traceback.format_exc()}
        print(json.dumps(details, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

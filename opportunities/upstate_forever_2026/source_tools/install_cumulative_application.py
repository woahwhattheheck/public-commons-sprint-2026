#!/usr/bin/env python3
"""Install the cumulative Upper Savannah source in a fresh application directory.

Uses the retained component authors' source transformations, composes their shared
lifecycle hooks, restores bundled original input bytes, and publishes one complete
application ZIP. Run with the existing scientific Python environment.
Use --scientific-source for the retained canonical Keowee/review family when
its original shared entrypoint differs from the current full checkout.
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


def component_inventory(root, *, allow_embedded=False):
    helper = runpy.run_path(str(Path(__file__).resolve().parents[1]
                                 / "source_tools/application_components.py"),
                            run_name="_application_component_closure")
    return helper["inspect_directory"](root, required=True, allow_embedded=allow_embedded)


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
            digest = hashlib.sha256()
            size = 0
            with path.open("rb") as stream:
                first = os.fstat(stream.fileno())
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
                    size += len(block)
                last = os.fstat(stream.fileno())
            fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
            if (any(getattr(first, field) != getattr(last, field) for field in fields)
                    or size != first.st_size):
                raise ValueError("Application source changed while being inventoried: " + str(relative))
            entries[relative.as_posix()] = {
                "bytes": size, "sha256": digest.hexdigest(),
                "mode": "100755" if first.st_mode & 0o111 else "100644",
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


def robust_registry_join(root, records):
    """Use the original owner retirement for an exact predecessor descriptor."""
    relative = "source/install_robust_workbench.py"
    if not (root / relative).is_file():
        return
    original = module(root, relative)
    legacy, retained = original["prepare_legacy_retirement"](root, {})
    old = original["target_path"](root, original["LEGACY"])
    target = original["target_path"](root, original["RETIRED"])
    if legacy is not None:
        original_mode = old.stat().st_mode & 0o777
        if (original["read_existing"](root, original["LEGACY"]) != legacy
                or original["read_existing"](root, original["RETIRED"]) != retained):
            raise ValueError("Original Decision registration changed during retirement")
        os.replace(old, target)
        if (target.read_bytes() != legacy
                or target.stat().st_mode & 0o777 != original_mode):
            raise ValueError("Original Decision registration retirement differs")
    records.append({"component": "Original Decision action registration",
                    "retained_as": original["RETIRED"],
                    "sha256": sha(legacy if legacy is not None else retained)
                    if legacy is not None or retained is not None else None})



def compose(root, records=None, *, source_root=None, application_source=None):
    if records is None:
        records = []
    application_source = root if application_source is None else application_source
    retained_source = Path(source_root).resolve(strict=True) if source_root is not None else None
    canonical_installers = (
        "source_tools/install_keowee_watershed_join.py",
        "source_tools/install_review_reconciliation.py",
    )
    if any((root / name).is_file() for name in canonical_installers):
        if retained_source is None or retained_source == root.resolve():
            raise ValueError("Pass the independent retained source_root when composing the Keowee and scientific-review families.")
    robust_registry_join(root, records)
    diagnostic_join(root, records)
    experiments = module(root, "install_experiments.py")
    apply_function(root, [
        ("operator/server.py", experiments["server_join"]),
        ("operator/web/app.mjs", experiments["app_join"]),
        ("operator/web/index.html", experiments["index_join"]),
        ("model/portable.py", experiments["portable_join"]),
    ], "Scenario experiments", records)
    conservation = module(root, "operator/install_conservation.py")
    registered_conservation = conservation["registered_conservation"](root)
    apply_function(root, [
        ("operator/server.py", lambda text: conservation["patch_server"](
            text, registered=registered_conservation)),
        ("operator/web/app.mjs", lambda text: conservation["patch_app"](
            text, registered=registered_conservation)),
        ("operator/web/index.html", lambda text: conservation["patch_index"](
            text, registered=registered_conservation)),
    ], "Conservation plans", records)
    if (root / "operator/install_chemistry.py").is_file():
        chemistry = module(root, "operator/install_chemistry.py")
        # Retain the complete application source independently of the canonical
        # Keowee/review source and the transformed installed application.
        result = chemistry["install"](root, source_root=application_source)
        records.append({"component": "Reach chemistry", "result": result})
    elif (root / "install_chemistry.py").is_file():
        # Earlier complete chemistry editions exposed their original transforms
        # at the root. The maintained root entrypoint is now CLI-only.
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
    context_desks_join(root, records, application_source=application_source)
    scientific_source_join(root, retained_source, records)
    continuity_join(root, records)
    return records


def scientific_source_join(root, source_root, records):
    """Run original scientific installers against their unchanged source edition."""
    installers = (
        ("Keowee methods and watershed scientific setup",
         "source_tools/install_keowee_watershed_join.py"),
        ("Original scientific review reconciliation",
         "source_tools/install_review_reconciliation.py"),
    )
    for title, relative in installers:
        if not (root / relative).is_file():
            continue
        if source_root is None or source_root.resolve() == root.resolve():
            raise ValueError("Retain the independent original scientific source before installation.")
        if not (source_root / relative).is_file():
            raise ValueError("The retained scientific source is missing its original installer: " + relative)
        result = module(source_root, relative)["install"](root, source_root)
        records.append({"component": title, "result": result})


def continuity_join(root, records):
    """Compose the complete continuity family through its original installers."""
    if not (root / "operator/extensions/project-continuity.json").is_file():
        return
    required = (
        "operator/project_continuity.py",
        "operator/extension_modules/project_continuity.py",
        "operator/project_transfer.py",
        "operator/extensions/project-transfer.json",
        "model/project_transfer.py",
        "model/project_transfer_workspace.py",
        "model/project_transfer_install.py",
        "source_tools/install_project_continuity.py",
        "source_tools/apply_dependency_startup.py",
    )
    missing = [name for name in required if not (root / name).is_file()]
    if missing:
        raise ValueError("Complete project continuity source is missing: " + ", ".join(missing))
    transport = module(root, "model/project_transfer_install.py")
    source = (root / "operator/server.py").read_text("utf-8")
    if not transport["registry_registration"](root, source):
        raise ValueError("Complete project continuity requires the maintained transfer descriptor and original shared provider.")
    apply_function(root, [
        ("operator/server.py", transport["registry_patch"]),
    ], "Single registered original transfer provider", records)
    result = module(root, "source_tools/install_project_continuity.py")["apply"](root)
    records.append({"component": "Complete project archive scope", "result": result})
    result = module(root, "source_tools/apply_dependency_startup.py")["apply"](root)
    records.append({"component": "Dependency-aware original extension startup", "result": result})


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

    calibration_path = "operator/install_calibration.py"
    if (root / calibration_path).is_file():
        calibration = module(root, calibration_path)
        complete("Calibration, source uncertainty, residual maps and saved reviews",
                 tuple(calibration["FILES"]) + (calibration_path,))
        result = calibration["install"](root, root)
        records.append({"component": "Calibration, source uncertainty, residual maps and saved reviews",
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
        if descriptor.get("version") == "2":
            complete("Southeast annual reference source", (
                "source/usgs-southeast-sparrow-2012/nitrogen-calibration.json",
                "source/usgs-southeast-sparrow-2012/phosphorus-calibration.json",
                "source/usgs-southeast-sparrow-2012/sediment-calibration.json",
                "source/usgs-southeast-sparrow-2012/P9A682GW-original-metadata.xml",
                "source/usgs-southeast-sparrow-2012/service-definition.json",
                "source/usgs-southeast-sparrow-2012/flowline-definition.json",
                "source/usgs-southeast-sparrow-2012/reach-crosswalk-1.json",
                "source/usgs-southeast-sparrow-2012/reach-crosswalk-2.json",
                "source/usgs-southeast-sparrow-2012/reach-crosswalk-3.json",
                "source/usgs-southeast-sparrow-2012/reach-crosswalk-4.json",
                "source/usgs-southeast-sparrow-2012/reach-crosswalk-5.json",
                "source/usgs-southeast-sparrow-2012/nldi/comid-6280111.json",
                "source/usgs-southeast-sparrow-2012/nldi/basin-comid-6280111.json",
                "source/usgs-southeast-sparrow-2012/nldi/comid-6269342.json",
                "source/usgs-southeast-sparrow-2012/nldi/basin-comid-6269342.json",
                "source/usgs-southeast-sparrow-2012/nldi/comid-11730084.json",
                "source/usgs-southeast-sparrow-2012/nldi/basin-comid-11730084.json",
                "source/usgs-southeast-sparrow-2012/nldi/comid-22724211.json",
                "source/usgs-southeast-sparrow-2012/nldi/basin-comid-22724211.json",
                "source_tools/sparrow_reference.py",
                "source_tools/SPARROW_REFERENCE.md",
                "source/usgs-southeast-sparrow-2012/nldi/comid-22726623.json",
                "source/usgs-southeast-sparrow-2012/nldi/basin-comid-22726623.json",
                "source/usgs-southeast-sparrow-2012/upper-savannah-all-targets-selection.json",
                "source/usgs-southeast-sparrow-2012/upper-savannah-tributaries-selection.json",
                "source/usgs-southeast-sparrow-2012/geometry-review.json",
            ))
        records.append({"component": "Original annual references",
                        "registration": "maintained extension registry",
                        "paths": list(annual)})


def context_desks_join(root, records, *, application_source=None):
    """Join complete original study and geography sources to the maintained host."""
    application_source = root if application_source is None else application_source
    def complete(label, paths):
        present = [(root / name).is_file() for name in paths]
        if not any(present):
            return False
        missing = [name for name, exists in zip(paths, present) if not exists]
        if missing:
            raise ValueError(label + " source cohort is incomplete: " + ", ".join(missing))
        return True

    def manifest(relative):
        path = root / relative
        document = json.loads(path.read_text("utf-8-sig"))
        if document.get("schema") != "upstate.sources/v1" or not document.get("entries"):
            raise ValueError("Receive the populated original source manifest: " + relative)
        members = {}
        for entry in document["entries"]:
            for item in (entry, *entry.get("companions", [])):
                name = item.get("path")
                if not isinstance(name, str) or not name or "\\" in name or "\0" in name:
                    raise ValueError("The original manifest has an invalid member: " + relative)
                original = path.parent / name
                resolved = original.resolve(strict=True)
                if not resolved.is_relative_to(root.resolve()):
                    raise ValueError("Source member leaves the complete application: " + relative)
                current = root
                for part in original.relative_to(root).parts:
                    current = current / part
                    if current.is_symlink():
                        raise ValueError("Source member uses a filesystem alias: " + str(original))
                if not resolved.is_file():
                    raise ValueError("Source member is not an ordinary file: " + str(original))
                body = resolved.read_bytes()
                if item.get("bytes") is not None and len(body) != item["bytes"]:
                    raise ValueError("Original source member length differs: " + str(original))
                if item.get("sha256") is not None and sha(body) != item["sha256"]:
                    raise ValueError("Original source member hash differs: " + str(original))
                key = resolved.relative_to(root.resolve()).as_posix()
                members[key] = {"path": key, "bytes": len(body), "sha256": sha(body)}
        return {"path": relative, "sha256": sha(path.read_bytes()),
                "entries": len(document["entries"]), "members": len(members),
                "source_bytes": sum(item["bytes"] for item in members.values())}

    design_path = "operator/install_conservation_design.py"
    namespace_helper = None
    if (root / design_path).is_file():
        namespace_helper = module(root, design_path)
        if complete("Scenario design", namespace_helper["FILES"]):
            result = namespace_helper["install"](root, root)
            records.append({"component": "Scenario design", "result": result})

    water_path = "operator/install_receiving_waters.py"
    if (root / water_path).is_file():
        complete("Receiving waters", (
            "docs/receiving_water_catalog.md",
            "model/RECEIVING_WATERS.md",
            "model/receiving_water_cli.py",
            "model/receiving_water_delivery.py",
            "model/receiving_water_journey.py",
            "model/receiving_water_spatial.py",
            "model/receiving_waters.py",
            "operator/RECEIVING_WATERS_OPERATOR.md",
            "operator/extensions/receiving-waters.json",
            "operator/install_receiving_waters.py",
            "operator/receiving_water_actions.py",
            "operator/receiving_water_browser.mjs",
            "operator/receiving_water_operate.py",
            "operator/receiving_waters.extension.json",
            "operator/web/receiving_water_spatial.mjs",
            "operator/web/receiving_waters.css",
            "operator/web/receiving_waters.mjs",
            "operator/web/receiving_waters_extension.mjs",
            "source/water_context/20261012/public-water/README.md",
            "source/water_context/20261012/public-water/metadata/public-water-0.json",
            "source/water_context/20261012/public-water/metadata/public-water-2.json",
            "source/water_context/20261012/public-water/raw/public-intakes.esri.json",
            "source/water_context/20261012/public-water/raw/scdes-arjws-prwd-source-water-protection-original.json",
            "source/water_context/20261012/public-water/receiving-waters.public-spec.json",
            "source/water_context/20261012/public-water/sources.public-native.json",
            "source_tools/PUBLIC_SOURCE_WATER_NATIVE.md",
            "source_tools/prepare_public_source_water.py",
            "source_tools/receiving_water_catalog.py",
            "source_tools/receiving_water_selection.schema.json",
        ))
        water = module(root, water_path)
        result = water["install"](root)
        records.append({"component": "Receiving waters", "result": result})

    study_path = "install_published_studies.py"
    if (root / study_path).is_file():
        study = module(root, study_path)
        required = tuple(study["CODE_FILES"]) + (
            "measurement_workspace/__init__.py",
            "observations/eighteenmile_2023/study.json",
            "observations/eighteenmile_2023/model-sources.json",
        )
        complete("Published studies", required)
        root_manifests = (
            "eighteenmile_chlorophyll_reconciled.sources.json",
            "eighteenmile_lake_observation_report.sources.json",
            "eighteenmile_lake_paired_analysis.sources.json",
            "eighteenmile_lake_microcystin_reconciliation.sources.json",
        )
        data_manifests = (
            "model-sources.json", "wqp/flow-context-sources.json",
            "wqp/flow-context-public-sources.json", "wqp_20261013/source-manifest.json",
            "figures/model-sources.json",
        )
        manifests = list(root_manifests) + [
            "observations/eighteenmile_2023/" + name for name in data_manifests]
        source_records = [manifest(name) for name in manifests if (root / name).is_file()]
        result = subprocess.run(
            [sys.executable, "-B", str(root / study_path), "--application", str(root)],
            cwd=root, capture_output=True, text=True, check=True)
        records.append({"component": "Published studies", "result": json.loads(result.stdout),
                        "original_source_manifests": source_records})

    station_path = "operator/install_station_geography.py"
    if (root / station_path).is_file():
        station = module(root, station_path)
        complete("Station geography", station["FILES"])
        source_records = []
        assessment = "source/station-assessment-context/sources.json"
        if (root / assessment).is_file():
            source_records.append(manifest(assessment))
        result = station["install"](root, root)
        records.append({"component": "Station geography", "result": result,
                        "original_source_manifests": source_records})

    observed_station_path = "operator/install_observed_station_studies.py"
    if (root / observed_station_path).is_file():
        observed_station = module(root, observed_station_path)
        complete("Original observation station studies", observed_station["FILES"])
        manifests = (
            "observations/station_context.sources.json",
            "calibration_station_geography.sources.json",
            "regional_station_context.sources.json",
            "observations/wbd_station_join_20261013/station-context.sources.json",
        )
        source_records = [manifest(name) for name in manifests if (root / name).is_file()]
        result = observed_station["install"](root, root)
        records.append({"component": "Original observation station studies",
                        "result": result, "original_source_manifests": source_records})

    soil = (
        "source_tools/soil_sources.py", "source_tools/soil_region.py",
        "source_tools/soil_coverage.py", "source_tools/SOIL_SOURCE.md",
        "source_tools/SOIL_REGION.md", "source_tools/SOIL_COVERAGE.md",
        "operator/regional_soil.py", "operator/REGIONAL_SOIL_DESK.md",
        "operator/extensions/regional-soil.json", "operator/web/regional_soil.mjs",
        "source/capture_upstream_network.py",
        "source/soil-interpretation-20261012/soil-erodibility-rule-form.body",
        "source/soil-interpretation-20261012/soil-erodibility-rule-form.capture.json",
    )
    if (root / "operator/extensions/regional-soil.json").is_file():
        complete("Regional soil", soil)
        descriptor = json.loads((root / "operator/extensions/regional-soil.json").read_text("utf-8"))
        if descriptor.get("schema") != "upstate.operator-extension/v1" or descriptor.get("id") != "regional-soil":
            raise ValueError("Receive the maintained Regional soil descriptor")
        records.append({"component": "Regional soil",
                        "registration": "maintained extension registry", "paths": list(soil)})

    context_path = "source/install_observed_context.py"
    if (root / context_path).is_file():
        complete("Original observed measurements", (
            context_path, "source/import_observed_context.py",
            "source/OBSERVED_CONTEXT.md", "source/observed_context_patch.json",
            "operator/web/observed_series.mjs",
        ))
        context = module(root, context_path)
        result = context["install"](
            root, root / "source/observed-context-install.json")
        records.append({"component": "Original observed measurements", "result": result})

    observed = "source_tools/receive_observed_context.py"
    if (root / observed).is_file():
        complete("Observed regional context", (
            observed, "source_tools/OBSERVED_CONTEXT.md",
            "source_tools/operate_assessment_context.py",
            "source_tools/prepare_public_source_water.py",
            "model/receiving_waters.py",
            "assessment/operate_assessment_maps.py",
            "source/water_context/20261012/public-water/receiving-waters.public-spec.json",
        ))
        names = (
            "assessment/geography-model-sources.json",
            "observations/observed_hydrology_20261013/model-sources.json",
            "observations/eighteenmile_2023/model-sources.json",
            "source/water_context/20261012/public-water/sources.public-native.json",
        )
        nutrient = "observations/observed_hydrology_20261013/nutrient_flow_contrasts/model-sources.json"
        if (root / nutrient).is_file():
            names += (nutrient,)
        records.append({"component": "Observed regional context",
                        "receiver": observed,
                        "original_source_manifests": [manifest(name) for name in names]})

    native_path = "operator/install_native_interactions.py"
    if (root / native_path).is_file():
        native = module(root, native_path)
        complete("Native conservation interactions", native["FILES"])
        result = native["install"](root, application_source)
        records.append({"component": "Native conservation interactions", "result": result})

    programme_interactions_path = "install_programme_interactions.py"
    if (root / programme_interactions_path).is_file():
        programme_interactions = module(root, programme_interactions_path)
        complete("Conservation studies in run programmes",
                 tuple(programme_interactions["SOURCE_FILES"]) + (programme_interactions_path,))
        result = programme_interactions["install"](root, root)
        records.append({"component": "Conservation studies in run programmes", "result": result})

    programme_study_path = "operator/install_programme_study.py"
    if (root / programme_study_path).is_file():
        complete("Native-study Programme export", (
            programme_study_path, "operator/programme_study_patch.json",
            "operator/PROGRAMME_NATIVE_STUDY.md", "model/native_study.py",
            "model/compute_programme.py", "operator/web/programmes.mjs"))
        result = module(root, programme_study_path)["install"](root, root)
        records.append({"component": "Native-study Programme export", "result": result})

    point_source_path = "operator/install_point_source_context.py"
    if (root / point_source_path).is_file():
        point_sources = module(root, point_source_path)
        complete("Retained point-source observation context", point_sources["FILES"])
        result = point_sources["install"](root, root)
        records.append({"component": "Retained point-source observation context", "result": result})

    analysis_source_path = "operator/install_analysis_source_context.py"
    if (root / analysis_source_path).is_file():
        analysis_sources = module(root, analysis_source_path)
        complete("Scenario analysis source context", analysis_sources["ADDITIONS"])
        result = analysis_sources["install"](root, root)
        records.append({"component": "Scenario analysis source context", "result": result})

    monitoring_path = "integrations/monitoring/install_observed_context.py"
    if (root / monitoring_path).is_file():
        adoption = json.loads((root / "integrations/monitoring/source_adoption.json").read_text("utf-8"))
        context = adoption.get("observational_context", {})
        source_manifests = context.get("source_manifests")
        if source_manifests is None:
            source_manifests = [context.get(
                "source_manifest", "eighteenmile_monitoring_context.sources.json")]
        if (not isinstance(source_manifests, list) or not source_manifests
                or any(not isinstance(name, str) or not name for name in source_manifests)
                or len(source_manifests) != len(set(source_manifests))):
            raise ValueError("Monitoring observational source manifests are invalid")
        complete("Monitoring observational context", tuple(
            item["path"] for item in adoption["installed_files"]) + (
                monitoring_path, "integration/monitoring_observed_sources.json"
            ) + tuple(source_manifests))
        for item in adoption["installed_files"]:
            body = (root / item["path"]).read_bytes()
            if len(body) != item["bytes"] or sha(body) != item["sha256"]:
                raise ValueError("Monitoring original runtime differs: " + item["path"])
        result = module(root, monitoring_path)["install"](root, application_source)
        records.append({"component": "Monitoring observational context", "result": result,
                        "original_source_manifests": [
                            manifest(name) for name in source_manifests]})

    # Use the maintained collector composition once on the actual receiving
    # source. Newer assemblers read these names from portable; older complete
    # source editions keep their original literal inventory.
    directories = tuple(name for name in (
        "scenario-design", "measurement_workspace", "observations",
        "assessment", "source_data", "wqp", "docs", "integrations") if (root / name).is_dir())
    if directories:
        if namespace_helper is None:
            raise ValueError("Receive the maintained source inventory installer")
        names = ["model/portable.py", "source_tools/application_assembly.py"]
        original = {name: (root / name).read_text("utf-8")
                    for name in names if (root / name).is_file()}
        proposed = namespace_helper["inventory_sources"](original, directories=directories)
        changes = []
        for name, text in proposed.items():
            ast.parse(text, filename=name)
            if (root / name).read_text("utf-8") != original[name]:
                raise ValueError("Application source collector changed during composition: " + name)
            if text != original[name]:
                write(root / name, text)
                changes.append({"path": name, "before": sha(original[name].encode("utf-8")),
                                "after": sha(text.encode("utf-8"))})
        records.append({"component": "Complete received source inventories",
                        "directories": list(directories), "changes": changes})



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


def archive_destination(destination, roots):
    """Keep the completed ZIP outside every retained application tree."""
    destination = Path(destination).expanduser().resolve(strict=False)
    for root in roots:
        root = Path(root).resolve(strict=False)
        if destination == root or destination.is_relative_to(root):
            raise ValueError("Put the application ZIP outside the source and receiving directories: "
                             + str(destination))
    if destination.exists() and not destination.is_file():
        raise ValueError("The application ZIP destination is not a file: " + str(destination))
    return destination


def receiving_paths(source, output, archive, scientific_source):
    """Resolve parent aliases before inventory, staging or source transformations."""
    source = Path(source).expanduser().resolve(strict=True)
    output = Path(output).expanduser().resolve(strict=False)
    scientific_root = (Path(scientific_source).expanduser().resolve(strict=True)
                       if scientific_source is not None else source)
    for retained in (source, scientific_root):
        if (output == retained or output.is_relative_to(retained)
                or retained.is_relative_to(output)):
            raise ValueError("Choose a receiving directory independent of the retained source: "
                             + str(retained))
    archive = archive_destination(archive, (source, output, scientific_root)) if archive else None
    return source, output, archive, scientific_root


def application_archive_files(root):
    """Retain the same ordered source members used by the published ZIP."""
    return [
        path for path in sorted(root.rglob("*"))
        if path.is_file() and not path.is_symlink() and not any(
            part.startswith(".") or part == "__pycache__"
            for part in path.relative_to(root).parts)
    ]


def archive_matches_application(archive, root, files):
    """Reopen an existing ZIP by streaming its members against installed files."""
    names = ["upper-savannah-application/" + path.relative_to(root).as_posix()
             for path in files]
    if archive.namelist() != names:
        return False
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    for name, path in zip(names, files):
        retained = archive.getinfo(name)
        selected = zipfile.ZipInfo.from_file(path, name, strict_timestamps=False)
        if (retained.file_size != selected.file_size
                or retained.create_system != selected.create_system
                or (retained.external_attr >> 16) != (selected.external_attr >> 16)):
            return False
        with archive.open(name) as left, path.open("rb") as right:
            before = os.fstat(right.fileno())
            while True:
                first, second = left.read(1024 * 1024), right.read(1024 * 1024)
                if first != second:
                    return False
                if not first:
                    break
            after = os.fstat(right.fileno())
        current = path.stat()
        if (any(getattr(before, field) != getattr(after, field) for field in fields)
                or any(getattr(after, field) != getattr(current, field) for field in fields)):
            raise ValueError("Application source changed while its archive was checked: "
                             + str(path.relative_to(root)))
    if application_archive_files(root) != files:
        raise ValueError("Application members changed while its archive was checked")
    return True


def archive_record(path):
    """Describe a completed ZIP without loading the compressed payload in RAM."""
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
            size += len(block)
        after = os.fstat(stream.fileno())
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size,
                             info.st_mtime_ns, info.st_ctime_ns)
    if identity(before) != identity(after) or size != before.st_size:
        raise ValueError("Application archive changed while its identity was recorded")
    return {"path": str(path), "bytes": size, "sha256": digest.hexdigest()}


def same_archive_members(current, proposed):
    """Compare original uncompressed members with bounded working memory."""
    names = current.namelist()
    if names != proposed.namelist():
        return False
    for name in names:
        left_info, right_info = current.getinfo(name), proposed.getinfo(name)
        if (left_info.file_size != right_info.file_size
                or left_info.create_system != right_info.create_system
                or left_info.external_attr != right_info.external_attr):
            return False
        with current.open(name) as left, proposed.open(name) as right:
            while True:
                first, second = left.read(1024 * 1024), right.read(1024 * 1024)
                if first != second:
                    return False
                if not first:
                    break
    return True


def archive_application(root, destination):
    root = Path(root).resolve(strict=True)
    destination = archive_destination(destination, (root,))
    component_inventory(root)
    files = application_archive_files(root)
    if destination.exists():
        # Reuse the completed transport directly. A second full compressed copy
        # is unnecessary, including when this receiver uses another zlib version.
        with destination.open("rb") as stream:
            before = os.fstat(stream.fileno())
            with zipfile.ZipFile(stream) as current:
                if not archive_matches_application(current, root, files):
                    raise ValueError("Another complete application owns " + str(destination))
            after = os.fstat(stream.fileno())
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        current = destination.stat()
        if (any(getattr(before, field) != getattr(after, field) for field in fields)
                or any(getattr(after, field) != getattr(current, field) for field in fields)):
            raise ValueError("Application archive changed while its members were checked")
        return archive_record(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".application-", dir=destination.parent, delete=False) as stream:
            temporary = Path(stream.name)
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6, strict_timestamps=False) as archive:
            for path in files:
                archive.write(path, "upper-savannah-application/" + path.relative_to(root).as_posix())
        record = archive_record(temporary)
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        os.link(temporary, destination)
        return {**record, "path": str(destination)}
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def install(source, output, archive, *, scientific_source=None):
    source, output, archive, scientific_root = receiving_paths(
        source, output, archive, scientific_source)
    if not (source / "model/workspace.py").is_file() or not (source / "operator/server.py").is_file():
        raise ValueError("Receive the complete source root before cumulative installation")
    original = owned_inventory(source)
    source_components = component_inventory(source, allow_embedded=True)
    source_identity = identity(original)
    scientific_installers = (
        "source_tools/install_keowee_watershed_join.py",
        "source_tools/install_review_reconciliation.py",
    )
    needs_scientific_source = any((source / name).is_file() for name in scientific_installers)
    scientific_original = None
    scientific_identity = None
    if needs_scientific_source:
        scientific_original = (original if scientific_root == source
                               else owned_inventory(scientific_root))
        scientific_identity = identity(scientific_original)
        for relative in scientific_installers:
            if (source / relative).is_file() and not (scientific_root / relative).is_file():
                raise ValueError("The canonical scientific source is missing: " + relative)
        keowee = "source_tools/install_keowee_watershed_join.py"
        if (source / keowee).is_file():
            # Validate exact canonical members before copying or transforming
            # the full current application. Current shared host bytes can differ.
            module(scientific_root, keowee)["package"](scientific_root)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        marker = json.loads((output / RECORD).read_text("utf-8"))
        if (marker.get("source_sha256") != source_identity
                or marker.get("scientific_source_sha256") != scientific_identity
                or marker.get("installed_files") != owned_inventory(output)):
            raise ValueError("The existing receiving edition has different source; choose its own output directory")
        installed_components = component_inventory(output)
        result = {"state": "current", "application": str(output), "source_sha256": source_identity,
                  "component_inventory": installed_components}
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
        phase = "verify_copied_source"
        if owned_inventory(root) != original:
            raise ValueError("Copied application source differs from its retained inventory")
        sys.path[:0] = [str(root / "operator"), str(root)]
        phase = "compose_application"
        compose(root, steps, source_root=scientific_root,
                application_source=source)
        phase = "restore_original_inputs"
        inputs = restore_inputs(root)
        phase = "check_application_sources"
        validation = check_sources(root)
        installed_components = component_inventory(root)
        validation["component_inventory"] = installed_components
        if installed_components["catalog_sha256"] != source_components["catalog_sha256"]:
            raise ValueError("A component installer changed the selected edition catalogue")
        if owned_inventory(source) != original:
            raise ValueError("The retained input source changed during installation")
        if (scientific_original is not None and scientific_root != source
                and owned_inventory(scientific_root) != scientific_original):
            raise ValueError("The retained canonical scientific source changed during installation")
        record = {"schema": "upstate.cumulative-installation/v1", "operation_id": OPERATION,
                  "source_sha256": source_identity,
                  "scientific_source_sha256": scientific_identity,
                  "steps": steps, "restored_inputs": inputs,
                  "source_component_inventory": source_components,
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
                   "scientific_source": str(scientific_root),
                   "scientific_source_sha256": scientific_identity,
                   "requested_output": str(output),
                   "retained_stage": str(staging),
                   "retained_application": str(root) if root.is_dir() else None,
                   "completed_steps": steps, "traceback": traceback.format_exc()}
        if getattr(error, "component_closure", None) is not None:
            details["component_inventory"] = error.component_closure
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
    parser.add_argument("--output", required=True, type=Path,
                        help="Independent receiving directory, including after resolving parent aliases")
    parser.add_argument("--archive", type=Path,
                        help="ZIP outside all source and receiving directories; an identical archive is reused")
    parser.add_argument("--scientific-source", type=Path,
                        help="Independent canonical Keowee/review family source; defaults to --source")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(install(args.source, args.output, args.archive,
                                 scientific_source=args.scientific_source), indent=2, ensure_ascii=False))
        return 0
    except Exception as error:
        details = getattr(error, "receiving_details", None)
        if details is None:
            details = {"state": "error", "error": type(error).__name__,
                       "message": str(error), "traceback": traceback.format_exc()}
        if getattr(error, "component_closure", None) is not None:
            details["component_inventory"] = error.component_closure
        print(json.dumps(details, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

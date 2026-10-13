"""Install the additive station geography desk in the existing complete application."""
from __future__ import annotations
import argparse
import ast
import datetime as dt
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile

FILES = (
    "model/native_assessment_review.py",
    "operator/web/native_assessment_review.mjs",
    "operator/NATIVE_ASSESSMENT_REVIEW.md",
    "source_tools/component_fragments.py",
    "integration/component_fragments/observed-station-wbd-nldi-197.json",
    "integration/component_fragments/assessment-scientific-report-consumer.json",
    "integration/observed-station-wbd-components.json",
    "model/station_geography.py",
    "model/station_inventory.py",
    "model/assessment_context.py",
    "model/assessment_report_context.py",
    "model/observed_station_studies.py",
    "model/observed_station_studies.json",
    "operator/assessment_context.py",
    "operator/extensions/assessment-context.json",
    "operator/web/assessment_context.mjs",
    "operator/web/assessment_context.css",
    "operator/ASSESSMENT_CONTEXT.md",
    "source/station-assessment-context/sources.json",
    "source/station-assessment-context/assessment-records-domain217.csv",
    "model/station_assessment_context.py",
    "model/station_study.py",
    "operator/PREPARED_STATION_STUDY.md",
    "operator/station_geography.py",
    "operator/web/station_geography.mjs",
    "operator/web/station_geography.css",
    "operator/extensions/station-geography.json",
    "operator/install_station_geography.py",
    "operator/STATION_GEOGRAPHY.md",
    "operator/fixtures/station_geography_actual87_ids.json",
    "model/utility_microbial_study.py",
    "model/UTILITY_MICROBIAL_STUDY.md",
    "operator/STATION_MICROBIAL_STUDY.md",
    "source/ecoli_utility_context/20261013/raw/stations-original.csv",
    "source/ecoli_utility_context/20261013/raw/stations-original.geojson",
    "source/ecoli_utility_context/20261013/raw/arjws-wbd-original.json",
    "source/ecoli_utility_context/20261013/raw/prwd-wbd-display.json",
    "source/ecoli_utility_context/20261013/raw/arjws-results-2021-2025-original.csv",
    "source/ecoli_utility_context/20261013/raw/prwd-results-2021-original.csv",
    "source/ecoli_utility_context/20261013/raw/prwd-results-2022-original.csv",
    "source/ecoli_utility_context/20261013/raw/prwd-results-2023-original.csv",
    "source/ecoli_utility_context/20261013/raw/prwd-results-2024-original.csv",
    "source/ecoli_utility_context/20261013/raw/prwd-results-2025-original.csv",
    "source/ecoli_utility_context/20261013/raw/utility-focus-profile.json",
    "source/ecoli_utility_context/20261013/raw/utility-memberships.csv",
    "source/ecoli_utility_context/20261013/results-with-provenance.csv",
    "source/ecoli_utility_context/20261013/station-membership.csv",
    "source/ecoli_utility_context/20261013/selected-stations.geojson",
    "source/ecoli_utility_context/20261013/station-year-method-summary.csv",
    "source/ecoli_utility_context/20261013/summary.json",
    "source/ecoli_utility_context/20261013/source-inputs.json",
    "source/ecoli_utility_context/20261013/README.md",
    "source/ecoli_utility_context/20261013/index.html",
    "source/ecoli_utility_context/20261013/build_ecoli_report.mjs",
    "source/ecoli_utility_context/20261013/source-manifest.json",
)

def sha(body):
    return hashlib.sha256(body).hexdigest()

def source_members(pending, manifest_name):
    """Verify every selected original source and companion before changing the app."""
    manifest = json.loads(pending[manifest_name])
    if manifest.get("schema") != "upstate.sources/v1" or not isinstance(manifest.get("entries"), list):
        raise ValueError("Retain the original source manifest: " + manifest_name)
    parent = PurePosixPath(manifest_name).parent
    checked, source_ids = [], set()
    for entry in manifest["entries"]:
        if not isinstance(entry, dict):
            raise ValueError("Each original source entry must be an object")
        companions = entry.get("companions", [])
        if not isinstance(companions, list):
            raise ValueError("Original source companions must be a list")
        source_id = entry.get("id")
        if not isinstance(source_id, str) or not source_id or source_id in source_ids:
            raise ValueError("Original source IDs must be unique and nonempty: " + manifest_name)
        source_ids.add(source_id)
        for member in [entry, *companions]:
            if not isinstance(member, dict):
                raise ValueError("Each original source companion must be an object")
            name = member.get("path")
            if not isinstance(name, str) or not name or "\\" in name or "\0" in name:
                raise ValueError("Original source members need portable relative paths")
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or path.as_posix() != name:
                raise ValueError("Original source member escapes its manifest: " + name)
            target = (parent / path).as_posix()
            if target not in pending:
                raise ValueError("Complete station source family omits original member: " + target)
            expected = member.get("sha256")
            if expected is not None and sha(pending[target]) != expected:
                raise ValueError("Original source bytes differ: " + target)
            checked.append({"source_id": source_id, "path": target,
                            "bytes": len(pending[target]), "sha256": sha(pending[target])})
    return checked



def installation_files(source_root):
    """Compose the owned files with the original WBD producer's selected inventory."""
    names = list(FILES)
    catalogue_name = "integration/observed-station-wbd-components.json"
    catalogue = json.loads((source_root / catalogue_name).read_bytes())
    if (not isinstance(catalogue, dict)
            or catalogue.get("schema") != "upstate.application-components/v1"
            or not isinstance(catalogue.get("components"), dict)):
        raise ValueError("Retain the original WBD application component catalogue")
    fragment_name = "integration/component_fragments/observed-station-wbd-nldi-197.json"
    loader_path = source_root / "source_tools/component_fragments.py"
    spec = importlib.util.spec_from_file_location("_station_component_fragments", loader_path)
    if spec is None or spec.loader is None:
        raise ValueError("Retain the maintained component fragment reader")
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    fragment, _ = reader._load(fragment_name, (source_root / fragment_name).read_text(encoding="utf-8"))
    if fragment.get("components"):
        raise ValueError("The WBD source extension must preserve its original component definitions")
    for component_id, extension in fragment.get("extend_components", {}).items():
        component = catalogue["components"].get(component_id)
        if not isinstance(component, dict):
            raise ValueError("The WBD extension names an unavailable original component: " + component_id)
        for field, additions in extension.items():
            existing = component.get(field, [])
            if not isinstance(existing, list):
                raise ValueError("The WBD catalogue needs its original array: " + field)
            component[field] = [*existing, *(value for value in additions if value not in existing)]
    for component_id in fragment.get("required_components", []):
        if component_id not in catalogue.get("required_components", []):
            raise ValueError("The WBD extension changes the original standalone component selection")
    selected = catalogue.get("required_components")
    if (not isinstance(selected, list) or not selected
            or any(not isinstance(value, str) or not value for value in selected)
            or len(selected) != len(set(selected))):
        raise ValueError("The WBD catalogue needs its explicit original component selection")
    for component_id in selected:
        component = catalogue["components"].get(component_id)
        if not isinstance(component, dict):
            raise ValueError("The WBD catalogue omits selected component: " + component_id)
        paths = component.get("paths")
        if not isinstance(paths, list) or not paths:
            raise ValueError("The selected WBD component needs its original source paths")
        for name in paths:
            if (not isinstance(name, str) or not name or "\\" in name
                    or any(ord(character) < 32 for character in name)):
                raise ValueError("WBD source paths must be portable relative names")
            path = PurePosixPath(name)
            if (path.is_absolute() or path.as_posix() != name
                    or any(part in {".", ".."} or ":" in part for part in path.parts)):
                raise ValueError("WBD source path leaves its original application: " + name)
            if name not in names:
                names.append(name)
    if "model/station_wbd_context.py" not in names:
        raise ValueError("The station geography source requires its original WBD context module")
    return tuple(names)

def scientific_report_host(application):
    """Require the maintained standalone composer before installing its consumer."""
    contracts = {
        "operator/web/app.mjs": (
            r"\bfunction\s+openScientificReport\s*\(",
            r"\bsourceReports\s*\.\s*openForSources\s*\(",
            r"\bcreateExtensionHost\s*\(\s*\{[\s\S]*?\bopenScientificReport\b",
        ),
        "operator/web/source_reports.mjs": (
            r"\battachScientificReportEditions\b",
            r"\bfunction\s+openForSources\s*\(",
            r"\bscientific\s*\.\s*openForSources\s*\(",
        ),
        "operator/web/source_report_editions.mjs": (
            r"\bfunction\s+attachScientificReportEditions\s*\(",
            r"\bfunction\s+openForSources\s*\(",
            r"\borderedReportSources\s*\(",
        ),
    }
    checked = []
    for name, patterns in contracts.items():
        path = application / name
        if not path.is_file():
            raise ValueError("Receive the maintained Scientific reports application before installing assessment report controls: " + name)
        body = path.read_bytes()
        source = body.decode("utf-8")
        if any(re.search(pattern, source) is None for pattern in patterns):
            raise ValueError("The installed Scientific reports host does not expose its original openForSources workflow: " + name)
        checked.append({"path": name, "bytes": len(body), "sha256": sha(body)})
    return checked

def install(application, source_root, *, dry_run=False):
    application, source_root = Path(application).resolve(strict=True), Path(source_root).resolve(strict=True)
    for name in ("model/workspace.py", "model/spatial_esri.py", "model/observed_context.py", "operator/server.py",
                 "operator/web/app.mjs", "operator/extension_registry.py", "operator/web/extension_host.mjs"):
        if not (application / name).is_file():
            raise ValueError("Receive the complete existing application before adding station geography: " + name)
    report_host = scientific_report_host(application)
    files = installation_files(source_root)
    pending, previous = {}, {}
    for name in files:
        body = (source_root / name).read_bytes()
        if name.endswith(".py"):
            ast.parse(body.decode("utf-8"), filename=name)
        elif name.endswith(".json"):
            value = json.loads(body)
            if name.endswith("station-geography.json") and value.get("schema") != "upstate.operator-extension/v1":
                raise ValueError("The station geography descriptor schema differs")
        pending[name] = body
        previous[name] = (application / name).read_bytes() if (application / name).exists() else None
    original_sources = {name: source_members(pending, name) for name in (
        "source/station-assessment-context/sources.json",
        "source/ecoli_utility_context/20261013/source-manifest.json",
        "observations/wbd_station_join_20261013/station-context.sources.json",
    )}
    changed = [name for name in files if previous[name] != pending[name]]
    server = (application / "operator/server.py").read_text(encoding="utf-8")
    browser = (application / "operator/web/app.mjs").read_text(encoding="utf-8")
    host_needed = "ExtensionRegistry" not in server or "createExtensionHost" not in browser
    if host_needed and not (application / "install_extensions.py").is_file():
        raise ValueError("Retain the existing authored install_extensions.py to join its original operator host")
    receipt = {"schema": "upstate.station-geography-install/v1", "application": str(application),
        "dry_run": dry_run, "changed": changed, "installed_files": len(files), "existing_host_install_needed": host_needed,
        "original_sources": original_sources, "scientific_report_host": report_host,
        "files": [{"path": name, "bytes": len(pending[name]), "sha256": sha(pending[name]),
                  "previous_sha256": sha(previous[name]) if previous[name] is not None else None} for name in files]}
    if dry_run:
        return receipt
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = application / ".station-geography-backups" / stamp
    with tempfile.TemporaryDirectory(prefix=".station-geography-install-", dir=application.parent) as temporary:
        staging = Path(temporary)
        for name in changed:
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(pending[name])
        for member in report_host:
            if sha((application / member["path"]).read_bytes()) != member["sha256"]:
                raise RuntimeError("Scientific reports host changed during station installation: " + member["path"])
        for name in changed:
            target = application / name
            current = target.read_bytes() if target.exists() else None
            if current != previous[name]:
                raise RuntimeError("Concurrent authored source changed during station installation: " + name)
        for name in changed:
            target = application / name
            if previous[name] is not None:
                original = backup / name
                original.parent.mkdir(parents=True, exist_ok=True)
                original.write_bytes(previous[name])
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staging / name, target)
    if host_needed:
        completed = subprocess.run([sys.executable, str(application / "install_extensions.py"),
            "--application", str(application), "--source-root", str(application)],
            check=True, capture_output=True, text=True, cwd=application)
        receipt["original_host_install"] = json.loads(completed.stdout)
    receipt["installed_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    receipt_path = application / "operator" / "station-geography-install.json"
    receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return receipt

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(install(args.application, args.source_root, dry_run=args.dry_run), indent=2, sort_keys=True))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Receive the original regional source and both utility exports with ordinary Python."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
from pathlib import Path
import platform
import sys
import tempfile
import time


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _json(path):
    return json.loads(Path(path).read_bytes())


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n",
                    encoding="utf-8")


def receive(application, output):
    started = time.monotonic()
    application = Path(application).resolve(strict=True)
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    selection_path = application / "source/utility-source-context/20261013/inputs.json"
    selected = _json(selection_path)
    if selected.get("schema") != "upstate.utility-source-context-inputs/v1":
        raise ValueError("Choose the original utility-source input manifest")
    inputs, originals, identities = {}, {}, {}
    for name in ("topology", "context", "coverage", "network"):
        descriptor = selected["sources"][name]
        path = (application / descriptor["path"]).resolve(strict=True)
        if not path.is_relative_to(application):
            raise ValueError("The selected original source leaves the application")
        body = path.read_bytes()
        if len(body) != descriptor["bytes"] or _sha(body) != descriptor["sha256"]:
            raise ValueError("The retained original source changed: " + name)
        inputs[name], originals[name] = json.loads(body), body
        identities[name] = dict(descriptor)
    profile_path = (application / selected["sources"]["topology"]["path"]).parent / inputs["topology"]["profile_file"]
    profile_path = profile_path.resolve(strict=True)
    if not profile_path.is_relative_to(application):
        raise ValueError("The original utility profile leaves the application")
    profile_body = profile_path.read_bytes()
    if _sha(profile_body) != inputs["topology"]["profile_sha256"]:
        raise ValueError("The original profile and utility topology have different source bytes")
    profile = json.loads(profile_body)
    profile_identity = {"filename": profile_path.name, "bytes": len(profile_body),
                        "sha256": _sha(profile_body), "schema": profile["schema"],
                        "title": profile["title"]}
    sys.path.insert(0, str(application))
    names = ("model.watershed_context", "model.utility_watershed_context", "model.watershed_brief")
    modules = [importlib.import_module(name) for name in names]
    receiver_path = Path(__file__).resolve(strict=True)
    receiver_body = receiver_path.read_bytes()
    implementation = {"receiver": {"path": str(receiver_path), "bytes": len(receiver_body),
                                    "sha256": _sha(receiver_body)}}
    for name, module in zip(names, modules):
        path = Path(module.__file__).resolve(strict=True)
        if not path.is_relative_to(application):
            raise ValueError("The receiving interpreter loaded another application: " + name)
        body = path.read_bytes()
        implementation[name] = {"path": path.relative_to(application).as_posix(),
                                "bytes": len(body), "sha256": _sha(body)}
    context, utilities, brief = modules
    observed_module = importlib.import_module("model.utility_observed_context")
    observed_path = Path(observed_module.__file__).resolve(strict=True)
    if not observed_path.is_relative_to(application):
        raise ValueError("The observed context belongs to another application")
    observed_body = observed_path.read_bytes()
    implementation["model.utility_observed_context"] = {
        "path": observed_path.relative_to(application).as_posix(),
        "bytes": len(observed_body), "sha256": _sha(observed_body)}
    report = context.build_watershed_context(
        inputs["context"], classification_coverage=inputs["coverage"], network=inputs["network"])
    choices = utilities.utility_selections(report, profile, profile_identity)
    unavailable = [row for row in choices if not row["available"]]
    if unavailable:
        raise ValueError("; ".join(row["title"] + ": " + row["reason"] for row in unavailable))
    destination = Path(tempfile.mkdtemp(prefix=report["id"] + "-", dir=output))
    regional = context.write_watershed_context(report, destination / "regional")
    originals["utility-profile"] = profile_body
    original_files = {}
    for name, body in originals.items():
        path = destination / "original-sources" / (name + ".json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        original_files[name] = {"path": path.relative_to(destination).as_posix(),
                                "bytes": len(body), "sha256": _sha(body)}
    _write(destination / "original-source-selection.json", selected)
    utility_results = []
    for choice in choices:
        selection = brief.selection_with_contributing_context(
            report, choice["huc12s"], regional["watershed-context.json"]["sha256"])
        selection["utility_selection"] = choice
        observed, observed_bodies = observed_module.load_for_utility(application, choice)
        if observed is not None:
            selection["observed_context"] = observed
        selection["supporting_source_references"] = [{
            "source_id": "original_utility_profile", "reference": choice["reference"],
            "sha256": profile_identity["sha256"],
        }, {"source_id": "original_native_network",
            "reference": inputs["topology"]["source"]["layer_uri"],
            "sha256": identities["network"]["sha256"]}]
        folder = destination / choice["key"]
        folder.mkdir()
        (folder / "original-utility-profile.json").write_bytes(profile_body)
        _write(folder / "selected-watersheds.json", selection)
        (folder / "selected-watersheds.csv").write_bytes(
            context._csv_bytes(selection["hucs"], context.HUC_COLUMNS))
        files = brief.write_selection_brief(folder, selection)
        if observed is not None:
            files.update(observed_module.retain(folder, observed, observed_bodies))
        for name in ("selected-watersheds.json", "selected-watersheds.csv", "original-utility-profile.json"):
            body = (folder / name).read_bytes()
            files[name] = {"path": name, "bytes": len(body), "sha256": _sha(body)}
        files["utility-watershed-packet.zip"] = observed_module.write_packet(folder, files)
        utility_results.append({
            "utility_id": choice["utility_id"], "selection_id": choice["key"],
            "directory": folder.relative_to(destination).as_posix(),
            "huc12s": choice["huc12s"], "summary": choice["summary"],
            "programme_designations": choice["programme_designations"], "files": files,
            "observed_summary": observed["utility"]["summary"] if observed is not None else None,
        })
    record = {
        "schema": "upstate.utility-native-source-receiving/v1",
        "operation_id": "UPSTATE-ORIGINAL-UTILITY-TOPOLOGY-20261013",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "python": platform.python_version(), "elapsed_seconds": time.monotonic() - started,
        "application": str(application), "output_directory": str(destination),
        "report_id": report["id"], "regional_summary": report["summary"],
        "native_network": report["network"], "implementation": implementation,
        "source_identities": identities, "profile_source": profile_identity,
        "original_files": original_files, "regional_directory": "regional",
        "regional_files": regional,
        "utilities": utility_results,
    }
    _write(destination / "receiving.json", record)
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--out", required=True, help="Existing operation's receiving output directory")
    args = parser.parse_args(argv)
    print(json.dumps(receive(args.application, args.out), ensure_ascii=False, allow_nan=False, indent=2))


if __name__ == "__main__":
    main()

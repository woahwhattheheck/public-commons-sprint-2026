#!/usr/bin/env python3
"""Render a separate Water inspection edition from completed original native files.

No original case file, result, recipe, archive or native receipt is rewritten.
The existing browser receiver opens the retained presentation through --inspection.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile

sys.dont_write_bytecode = True
import water_report

SCHEMA = "tjlabs.water-reconciliation.inspection-edition.v1"
INPUT = "tjlabs.water-reconciliation.inspection-input.v1"
HERE = Path(__file__).resolve().parent


def require(value, message):
    if not value:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def read_json(path):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, "Duplicate JSON key: " + key)
            value[key] = item
        return value
    def constant(value):
        raise ValueError("Nonfinite JSON: " + value)
    return json.loads(Path(path).read_bytes().decode("utf-8"),
                      object_pairs_hook=pairs, parse_constant=constant)


def measure(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "Select an original regular file")
    digest = hashlib.sha256()
    count = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
            count += len(block)
    return {"bytes": count, "sha256": digest.hexdigest()}


def original(path, boundary):
    candidate = Path(path)
    require(not candidate.is_symlink(), "Original path must not be a symbolic link")
    resolved = candidate.resolve(strict=True)
    require(resolved.is_relative_to(boundary) and resolved != boundary,
            "Original file is outside its selected native directory")
    require(candidate.absolute() == resolved, "Original path has a symbolic parent")
    return resolved


def identity(path):
    return {"path": str(path), **measure(path)}


def immutable(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.is_file() and not path.is_symlink() and path.read_bytes() == body,
                "Existing inspection artifact differs: " + path.name)
        return
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receiving", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    receiving_path = Path(args.receiving).resolve(strict=True)
    native_root = receiving_path.parent
    receiving = read_json(receiving_path)
    require(receiving.get("schema") == "tjlabs.water-reconciliation.receiving.v1"
            and receiving.get("status") == "COMPLETE",
            "Select the original completed native receiving.json")
    paths = receiving.get("rendered_reports")
    require(isinstance(paths, list) and len(paths) >= 3
            and all(isinstance(value, str) for value in paths),
            "Original, following and native cold report paths are required")
    output = Path(args.output).absolute()
    require(output == output.resolve(), "Inspection output must not have symbolic parents")
    require(not output.is_relative_to(native_root) and not native_root.is_relative_to(output),
            "Keep the presentation edition outside the original native operation")
    if output.exists():
        require(args.resume and output.is_dir() and not output.is_symlink(),
                "Choose a new output or resume the identical original inspection")
    else:
        output.mkdir(parents=True)
    originals = []
    for supplied in paths:
        file = original(native_root / supplied, native_root)
        require(file.name == "report.html" and file.parent.name == "water",
                "Select the original native water report")
        case = file.parent.parent
        documents = {name: original(case / name, case)
                     for name in ("water/result.json", "report.json", "manifest.json")}
        result = read_json(documents["water/result.json"])
        require(result.get("schema") == water_report.RESULT_SCHEMA,
                "Original result schema differs")
        inputs = []
        for item in result.get("source_inputs", []):
            table = item.get("table")
            require(isinstance(table, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,95}", table)
                    and item.get("retained_path") == "inputs/" + table + ".csv",
                    "Original source path differs")
            source = original(case / item["retained_path"], case)
            current = measure(source)
            require(current == {key: item[key] for key in ("bytes", "sha256")},
                    "Complete original source bytes differ")
            inputs.append({"table": table, "retained_path": item["retained_path"],
                           "path": str(source), **current})
        originals.append({"case": str(case), "original_html": identity(file),
                          "documents": {name: identity(path) for name, path in documents.items()},
                          "source_inputs": inputs, "source_run_identity": result["source_run_identity"]})
    require(len({item["original_html"]["path"] for item in originals}) == len(originals),
            "Original report selection must be unique")
    selected = {"schema": INPUT, "native_receiving": identity(receiving_path),
                "renderer": identity(Path(water_report.__file__).resolve()),
                "producer": identity(Path(__file__).resolve()), "reports": originals}
    lock = (output / "inspection.lock").open("a+b")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        immutable(output / "inspection-input.json", encoded(selected))
        reports = []
        for index, item in enumerate(originals):
            documents = item["documents"]
            text = water_report.render_html(
                read_json(documents["water/result.json"]["path"]),
                read_json(documents["report.json"]["path"]),
                read_json(documents["manifest.json"]["path"]))
            destination = output / ("report-" + str(index)) / "water" / "report.html"
            immutable(destination, text.encode("utf-8"))
            reports.append({**item, "presentation": identity(destination)})
        # Confirm that every selected source and producer stayed unchanged during rendering.
        for selected_file in [selected["native_receiving"], selected["renderer"], selected["producer"]]:
            require(measure(selected_file["path"]) ==
                    {key: selected_file[key] for key in ("bytes", "sha256")},
                    "Selected receiving or renderer changed during presentation")
        for item in originals:
            for selected_file in [item["original_html"], *item["documents"].values(),
                                  *item["source_inputs"]]:
                require(measure(selected_file["path"]) ==
                        {key: selected_file[key] for key in ("bytes", "sha256")},
                        "Original native bytes changed during presentation")
        receipt = {"schema": SCHEMA, "status": "INSPECTION_RENDERED",
                   "native_receiving": selected["native_receiving"],
                   "renderer": selected["renderer"], "producer": selected["producer"],
                   "input": identity(output / "inspection-input.json"), "reports": reports,
                   "meaning": "Separate presentation of exact retained native results. Original calculation, recipe files, native cases, archives and completed receiving remain unchanged.",
                   "visual_review": "PENDING_ACTUAL_BROWSER_AND_SCREENSHOT_PDF_VIEWING"}
        immutable(output / "inspection.json", encoded(receipt))
        print(json.dumps(receipt, ensure_ascii=False))
        return 0
    finally:
        lock.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"status": "ERROR", "type": type(error).__name__, "message": str(error)}))
        raise SystemExit(2)

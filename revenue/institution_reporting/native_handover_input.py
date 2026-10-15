#!/usr/bin/env python3
"""Create complete institution-report input from authorized native handover ZIPs.

Standard library only. Retains the entire input ZIPs and selection. Does not execute
any embedded Python, contact a service, alter the native workspace, or supply views
from metadata/preview rows.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import zipfile

MAX_BYTES = 128 * 1024 * 1024
MAX_SOURCE_BYTES = 32 * 1024 * 1024
MAX_SELECTION_BYTES = 2 * 1024 * 1024
KINDS = ("bankregdata_sources", "bankregdata_views", "bankregdata_comparisons",
         "bankregdata_reviews", "bankregdata_review_versions")
HEX = re.compile(r"[a-f0-9]{64}\Z")
PROVENANCE = "nativeHandoverProvenance"


class AdmissionError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise AdmissionError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def utf8(raw, label):
    try:
        value = raw.decode("utf-8", errors="strict")
        require(value.encode("utf-8") == raw, label + ": original UTF-8 bytes differ")
        return value
    except UnicodeError as exc:
        raise AdmissionError(label + ": select an original UTF-8 source; no silent transcoding") from exc


def strict_json(raw, label):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, label + ": duplicate JSON member " + key)
            result[key] = value
        return result
    def constant(value):
        raise AdmissionError(label + ": invalid JSON number " + value)
    try:
        return json.loads(utf8(raw, label), object_pairs_hook=pairs, parse_constant=constant)
    except (json.JSONDecodeError, RecursionError) as exc:
        raise AdmissionError(label + ": invalid complete JSON") from exc


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def stable_bytes(path, limit):
    path = Path(path).absolute()
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and not path.is_symlink(), "Select a regular original: " + str(path))
    require(0 < before.st_size <= limit, "Original exceeds its byte limit: " + str(path))
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    fd = os.open(path, flags)
    try:
        current = os.fstat(fd)
        require(stat.S_ISREG(current.st_mode) and
                (current.st_dev, current.st_ino) == (before.st_dev, before.st_ino),
                "Original changed while opening: " + str(path))
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, min(1024 * 1024, limit + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            require(size <= limit, "Original grew beyond its byte limit: " + str(path))
        after = os.fstat(fd)
        end_path = path.lstat()
        fields = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        require(fields(current) == fields(after) == fields(end_path) and size == current.st_size,
                "Original changed during reading: " + str(path))
        return b"".join(chunks)
    finally:
        os.close(fd)


def safe_member(name):
    require(isinstance(name, str) and name and "\\" not in name and "\0" not in name
            and ":" not in name and not name.startswith("/")
            and all(part not in ("", ".", "..") for part in name.split("/")),
            "Unsupported handover member path")


def indexed_records(files, manifest):
    records = strict_json(files["records.json"], "records.json")
    require(isinstance(records, dict) and set(records) == set(KINDS),
            "Complete native record families are required")
    indexed = {}
    for kind in KINDS:
        require(isinstance(records[kind], list), "Invalid native record family")
        indexed[kind] = {}
        for item in records[kind]:
            require(isinstance(item, dict) and isinstance(item.get("id"), str)
                    and item["id"] and item["id"] not in indexed[kind],
                    "Invalid or duplicate native record ID")
            indexed[kind][item["id"]] = item
            for key in ("sha256", "view_sha256", "engine_sha256", "analysis_sha256"):
                if item.get(key):
                    require(isinstance(item[key], str) and HEX.fullmatch(item[key])
                            and "objects/" + item[key] in files,
                            "Missing retained native object: " + key)
    require(set(indexed["bankregdata_comparisons"]) == {manifest["comparison_id"]},
            "Handover must retain its one original comparison")
    saved = indexed["bankregdata_comparisons"][manifest["comparison_id"]]
    analysis = files["objects/" + saved["analysis_sha256"]]
    comparison = strict_json(analysis, "original analysis")
    record = strict_json(files["review.json"], "review.json")
    require(len(analysis) == saved["analysis_bytes"] and
            comparison == strict_json(files["comparison.json"], "comparison.json") ==
            record["comparison"] and comparison["id"] == manifest["comparison_id"],
            "Original comparison identity differs")
    for key in ("title", "created_at", "created_by", "request_key", "request_digest",
                "counts", "entities", "metrics"):
        require(comparison[key] == saved[key], "Comparison metadata differs: " + key)
    source_ids, view_ids = set(), set()
    selections = [comparison[side] for side in ("before", "after")] + comparison.get("supporting_views", [])
    for selection in selections:
        view, source = selection["view"], selection["source"]
        require(indexed["bankregdata_views"].get(view["id"]) == view and
                indexed["bankregdata_sources"].get(source["id"]) == source and
                view["source_id"] == source["id"],
                "Original source/view selection differs")
        source_ids.add(source["id"])
        view_ids.add(view["id"])
        original = files["objects/" + source["sha256"]]
        view_raw = files["objects/" + view["view_sha256"]]
        mapped = strict_json(view_raw, "complete mapped view")
        require(len(original) == source["bytes"] <= MAX_SOURCE_BYTES and
                len(view_raw) == view["view_bytes"] and
                mapped["schema"] == "commons.bankregdata-view.v1" and
                mapped["source_sha256"] == source["sha256"] and mapped["mapping"] == view["mapping"],
                "Original source or full mapped-view binding differs")
        for key in ("entities", "periods", "metrics", "observation_count"):
            require(mapped[key] == view[key], "Mapped view summary differs: " + key)
        require(isinstance(mapped["observations"], list) and
                type(mapped["observation_count"]) is int and
                mapped["observation_count"] == len(mapped["observations"]) <= 250000,
                "Incomplete native mapped-view observations")
        require(all(isinstance(o, dict) and isinstance(o.get("source"), dict) and
                    o["source"].get("sha256") == source["sha256"] for o in mapped["observations"]),
                "Observation source differs from native source")
        require(files["originals/" + source["id"] + "." + source["format"]] == original and
                strict_json(files["originals/" + source["id"] + ".metadata.json"], "source metadata") == source,
                "Complete original-source copy differs")
    require(source_ids == set(indexed["bankregdata_sources"]) and
            view_ids == set(indexed["bankregdata_views"]),
            "Native selected source/view closure differs")
    for side in ("before", "after"):
        require(saved[side + "_view_id"] == comparison[side]["view"]["id"] and
                saved[side + "_period"] == comparison[side]["period"],
                "Comparison selected period or view differs")
    require(files["engine/bankregdata_native.py"] == files["objects/" + comparison["engine_sha256"]],
            "Original native replay engine differs")
    supporting = record.get("supporting_views", [])
    expected_supporting = comparison.get("supporting_views", [])
    require(len(supporting) == len(expected_supporting), "Missing supporting mapped reports")
    for value, selection in zip(supporting, expected_supporting):
        require(value["view"] == selection["view"] and value["source"] == selection["source"] and
                value["data"] == strict_json(files["objects/" + selection["view"]["view_sha256"]], "supporting view") and
                value == strict_json(files["supporting-views/" + selection["view"]["id"] + ".json"], "supporting selection"),
                "Supporting mapped report differs")
    for key, kind in (("reviews", "bankregdata_reviews"), ("history", "bankregdata_review_versions")):
        require(sorted(record[key], key=lambda x: x["id"]) == sorted(records[kind], key=lambda x: x["id"]) and
                all(x["comparison_id"] == comparison["id"] for x in records[kind]),
                "Original reviewer history differs")
    return indexed


def read_handover(raw, filename):
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_BYTES, "Handover ZIP exceeds 128 MiB")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            require(1 <= len(infos) <= 4096, "Handover member count exceeds 4096")
            names = [x.filename for x in infos]
            for name in names:
                safe_member(name)
            require(len(set(names)) == len(names) == len({x.casefold() for x in names}),
                    "Duplicate or case-colliding handover members")
            total = sum(x.file_size for x in infos)
            require(total <= MAX_BYTES, "Expanded handover exceeds 128 MiB")
            for item in infos:
                require(not item.is_dir() and not item.flag_bits & 1 and
                        item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and
                        stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG),
                        "Unsupported encrypted, linked or non-file ZIP member")
            require("manifest.json" in names, "Missing native manifest")
            manifest_raw = archive.read("manifest.json")
            manifest = strict_json(manifest_raw, "manifest.json")
            require(isinstance(manifest, dict) and
                    manifest.get("schema") == "commons.bankregdata-handover.v1" and
                    isinstance(manifest.get("files"), list), "Choose a native review handover")
            bound = {}
            for item in manifest["files"]:
                require(isinstance(item, dict), "Invalid member manifest")
                name = item["path"]
                safe_member(name)
                require(name != "manifest.json" and name not in bound and
                        type(item.get("bytes")) is int and 0 <= item["bytes"] <= MAX_BYTES and
                        isinstance(item.get("sha256"), str) and HEX.fullmatch(item["sha256"]),
                        "Invalid or duplicate member identity")
                bound[name] = item
            require(set(bound) | {"manifest.json"} == set(names), "Complete member list differs")
            files = {}
            for name, identity in bound.items():
                value = archive.read(name)
                require(len(value) == identity["bytes"] and sha(value) == identity["sha256"],
                        "Retained member differs: " + name)
                if name.startswith("objects/"):
                    require(HEX.fullmatch(name[8:]) and sha(value) == name[8:],
                            "Native object name differs from original bytes")
                files[name] = value
        indexed = indexed_records(files, manifest)
        return {"filename": filename, "raw": raw, "sha256": sha(raw), "bytes": len(raw),
                "expandedBytes": total, "manifest": manifest, "manifestText": utf8(manifest_raw, "manifest"),
                "files": files, "indexed": indexed}
    except (KeyError, TypeError, zipfile.BadZipFile, UnicodeError, RuntimeError, OverflowError) as exc:
        raise AdmissionError("Incomplete or invalid original native handover: " + str(exc)) from exc


def load_handovers(paths):
    require(1 <= len(paths) <= 16, "Select one to sixteen authorized handovers")
    result, seen, original_total, expanded_total = [], set(), 0, 0
    for path in paths:
        raw = stable_bytes(path, MAX_BYTES)
        identity = sha(raw)
        require(identity not in seen, "The same handover ZIP was selected twice")
        seen.add(identity)
        original_total += len(raw)
        require(original_total <= MAX_BYTES, "Combined original ZIPs exceed 128 MiB")
        handover = read_handover(raw, Path(path).name)
        expanded_total += handover["expandedBytes"]
        require(expanded_total <= MAX_BYTES, "Combined expanded handovers exceed 128 MiB")
        result.append(handover)
    return result


def inspect_handovers(handovers):
    return {"schema": "commons.institution-handover-inspection.v1", "handovers": [
        {"filename": h["filename"], "sha256": h["sha256"], "bytes": h["bytes"],
         "expandedBytes": h["expandedBytes"], "editionId": h["manifest"]["id"],
         "comparisonId": h["manifest"]["comparison_id"],
         "sources": list(h["indexed"]["bankregdata_sources"].values()),
         "views": list(h["indexed"]["bankregdata_views"].values())} for h in handovers]}


def build_input(selection_raw, handovers):
    require(0 < len(selection_raw) <= MAX_SELECTION_BYTES, "Selection exceeds 2 MiB")
    selection = strict_json(selection_raw, "complete selection")
    require(isinstance(selection, dict) and
            selection.get("schema") == "commons.institution-report-input.v1",
            "Choose a complete report selection")
    require("originals" not in selection and "views" not in selection and PROVENANCE not in selection,
            "Selection must leave originals, views and native provenance to the adapter")
    selected = selection.get("selectedViewIds")
    require(isinstance(selected, list) and 1 <= len(selected) <= 64 and
            all(isinstance(x, str) and x for x in selected) and len(set(selected)) == len(selected),
            "Choose one to 64 unique original selectedViewIds")
    available = {}
    for h in handovers:
        for ident, view in h["indexed"]["bankregdata_views"].items():
            source = h["indexed"]["bankregdata_sources"][view["source_id"]]
            entry = {"view": view, "source": source, "handover": h}
            if ident in available:
                old = available[ident]
                require(old["view"] == view and old["source"] == source,
                        "Conflicting saved source/view ID across handovers: " + ident)
            else:
                available[ident] = entry
    require(all(x in available for x in selected), "A selected native view ID is absent")
    originals, documents, bindings = {}, {}, []
    for ident in selected:
        entry = available[ident]
        view, source, h = entry["view"], entry["source"], entry["handover"]
        source_raw = h["files"]["objects/" + source["sha256"]]
        source_text = utf8(source_raw, "selected original " + source["id"])
        view_raw = h["files"]["objects/" + view["view_sha256"]]
        view_text = utf8(view_raw, "selected mapped view " + ident)
        original = {"filename": source["filename"], "sha256": source["sha256"], "text": source_text}
        if source["sha256"] not in originals:
            originals[source["sha256"]] = original
        if view["view_sha256"] not in documents:
            documents[view["view_sha256"]] = {"sha256": view["view_sha256"], "text": view_text}
        bindings.append({"viewId": ident, "sourceId": source["id"], "viewSha256": view["view_sha256"],
                         "sourceSha256": source["sha256"], "engineSha256": view["engine_sha256"],
                         "handoverSha256": h["sha256"], "viewRecord": copy.deepcopy(view),
                         "sourceRecord": copy.deepcopy(source)})
    require(len(originals) <= 32, "Compiler permits at most 32 complete original sources")
    result = copy.deepcopy(selection)
    del result["selectedViewIds"]
    result["originals"] = list(originals.values())
    result["views"] = list(documents.values())
    result[PROVENANCE] = {
        "schema": "commons.institution-native-handover-provenance.v1",
        "selectionSha256": sha(selection_raw), "selectionText": utf8(selection_raw, "selection"),
        "selectedViewIds": list(selected), "bindings": bindings,
        "handovers": [{"filename": h["sha256"] + ".zip", "sha256": h["sha256"], "bytes": h["bytes"],
                      "expandedBytes": h["expandedBytes"],
                      "retainedPath": "original-handovers/" + h["sha256"] + ".zip",
                      "manifestSha256": sha(h["manifestText"].encode("utf-8")),
                      "manifestText": h["manifestText"]} for h in handovers],
        "validation": "Complete native manifest, objects, source/view/analysis/review closure verified; embedded engine not executed."
    }
    raw = encoded(result)
    require(len(raw) <= MAX_BYTES, "Complete report input exceeds 128 MiB; retain originals and revise the agreed selection")
    return result, raw


def sync_directory(path):
    if os.name == "nt":
        return
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_directory(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and path.resolve() == path,
            "Use a canonical private output directory")
    if os.name == "posix":
        require(info.st_mode & 0o077 == 0, "Private output directory must have mode 0700")
    return path


def retain(path, raw):
    path = Path(path)
    try:
        existing = path.lstat()
    except FileNotFoundError:
        existing = None
    if existing is not None:
        require(stat.S_ISREG(existing.st_mode) and not path.is_symlink(),
                "Preserve nonregular existing output: " + str(path))
        require(stable_bytes(path, max(1, len(raw))) == raw, "Preserve different existing output: " + str(path))
        return
    fd, temp = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temp, path)
        except FileExistsError:
            require(stable_bytes(path, max(1, len(raw))) == raw, "Concurrent different output: " + str(path))
        sync_directory(path.parent)
    finally:
        Path(temp).unlink(missing_ok=True)


def publish(selection_raw, handovers, output):
    _, raw = build_input(selection_raw, handovers)
    out = private_directory(output)
    original_dir = private_directory(out / "original-handovers")
    products = {"selection.json": selection_raw, "input.json": raw}
    products.update({"original-handovers/" + h["sha256"] + ".zip": h["raw"] for h in handovers})
    manifest = {
        "schema": "commons.institution-native-input-delivery.v1",
        "inputSha256": sha(raw), "selectionSha256": sha(selection_raw),
        "files": [{"path": name, "bytes": len(value), "sha256": sha(value)}
                  for name, value in sorted(products.items())]
    }
    # Validate every previous product before publishing any new product on retry.
    for name, value in products.items():
        path = out / name
        if path.exists() or path.is_symlink():
            require(stable_bytes(path, max(1, len(value))) == value, "Existing output belongs to another selection: " + name)
    manifest_raw = encoded(manifest)
    if (out / "manifest.json").exists() or (out / "manifest.json").is_symlink():
        require(stable_bytes(out / "manifest.json", MAX_BYTES) == manifest_raw, "Existing completion manifest differs")
    for name, value in products.items():
        retain(out / name, value)
    retain(out / "manifest.json", manifest_raw)
    return {"state": "COMPLETE", "directory": str(out), **manifest}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect", help="Read complete handovers and list exact source/view selections")
    inspect.add_argument("--handover", action="append", required=True, type=Path)
    build = sub.add_parser("build", help="Retain originals and assemble exact compiler input")
    build.add_argument("--handover", action="append", required=True, type=Path)
    build.add_argument("--selection", required=True, type=Path)
    build.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        handovers = load_handovers(args.handover)
        if args.command == "inspect":
            result = inspect_handovers(handovers)
        else:
            result = publish(stable_bytes(args.selection, MAX_SELECTION_BYTES), handovers, args.output)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (AdmissionError, OSError, ValueError, KeyError, TypeError) as exc:
        print("Handover input not published: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

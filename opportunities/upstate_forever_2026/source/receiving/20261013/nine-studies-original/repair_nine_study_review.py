#!/usr/bin/env python3
"""Repair delayed saved-review reads in the original Nine Study reader.

The original HTML and every embedded observation remain unchanged on disk.
Writes a distinct repaired HTML and an exact source/output receipt.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

REPLACEMENT_PATH = Path(__file__).with_name("saved-view-replacements.json")
REPLACEMENT_SPEC = json.loads(REPLACEMENT_PATH.read_text(encoding="utf-8"))
if REPLACEMENT_SPEC.get("schema") != "upstate.station-review-replacements/v2":
    raise ValueError("Unsupported saved-view replacement manifest")
REPAIRS = REPLACEMENT_SPEC["replacements"]
for item in REPAIRS:
    if hashlib.sha256(item["old"].encode("utf-8")).hexdigest() != item["preimage_sha256"]:
        raise ValueError("A replacement preimage hash is invalid")
    if hashlib.sha256(item["new"].encode("utf-8")).hexdigest() != item["postimage_sha256"]:
        raise ValueError("A replacement postimage hash is invalid")
SOURCE_SHA256 = REPLACEMENT_SPEC["source_html_sha256"]
DATA = re.compile(r'<script\b(?=[^>]*\bid=["\x27]data["\x27])[^>]*>([\s\S]*?)</script>', re.I)

def identity(body):
    return {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}

def retain(path, body):
    if path.exists():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != body:
            raise ValueError("A different file already exists at " + str(path))
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name("." + path.name + ".pending")
    with pending.open("xb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(pending, path)

def repair(input_path, output_path, expected_sha256=None):
    source = Path(input_path).resolve(strict=True)
    target = Path(output_path).resolve()
    if source == target:
        raise ValueError("Choose a distinct output HTML; retain the original reader")
    original = source.read_bytes()
    input_sha256 = identity(original)["sha256"]
    if expected_sha256 and input_sha256 != expected_sha256:
        raise ValueError("The original reader differs from the selected SHA-256")
    text = original.decode("utf-8")
    payloads = DATA.findall(text)
    if len(payloads) != 1:
        raise ValueError("Expected exactly one original embedded data script")
    states = [(text.count(item["old"]), text.count(item["new"])) for item in REPAIRS]
    if input_sha256 == SOURCE_SHA256 and all(state == (1, 0) for state in states):
        for item in REPAIRS:
            text = text.replace(item["old"], item["new"], 1)
        changed = True
    elif input_sha256 == REPLACEMENT_SPEC["output_html_sha256"] and all(state == (0, 1) for state in states):
        changed = False
    else:
        raise ValueError("The viewer is not the exact original or complete repaired edition; inspect its maintained source")
    if DATA.findall(text) != payloads:
        raise ValueError("The embedded original data changed")
    output = text.encode("utf-8")
    if identity(output)["sha256"] != REPLACEMENT_SPEC["output_html_sha256"]:
        raise ValueError("The repaired reader differs from the manifest output hash")
    receipt = {
        "schema": "upstate.station-review-saved-view-repair/v1",
        "original": {"filename": source.name, **identity(original)},
        "output": {"filename": target.name, **identity(output)},
        "embedded_original_data": identity(payloads[0].encode("utf-8")),
        "repair_script": identity(Path(__file__).read_bytes()),
        "changed": changed,
        "scope": "saved-review ownership, responsive map fit and numeric table readability",
        "replacement_manifest_sha256": hashlib.sha256(REPLACEMENT_PATH.read_bytes()).hexdigest(),
        "source_html_sha256_expected": SOURCE_SHA256,
        "original_library_file_id": "libfile_15558dd7231081918054f037544f2dc3",
        "original_archive_sha256": "e845f21e67a27ebca3ac7cdffe522f67fd00cbc37b8171956fef2cbbc036366c",
    }
    retain(target, output)
    receipt_path = target.with_name(target.name + ".repair.json")
    retain(receipt_path, (json.dumps(receipt, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return {**receipt, "path": str(target), "receipt": str(receipt_path)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected-sha256")
    args = parser.parse_args()
    print(json.dumps(repair(args.input, args.output, args.expected_sha256), ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

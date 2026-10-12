#!/usr/bin/env python3
"""Materialize the complete original NCT03529110 Research programme.

Uses the unchanged Research source receiver for canonical ordinary directories
and atomic exact-byte writes. This command only installs the selected source and
original inputs; the existing native controller owns programme execution.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import stat
import sys
from pathlib import Path

HELPER_SHA256 = "90d60e55d1838215c7252cc2a79db5ad8509bf01b44bbbbe79af1dc98fa3635f"
SCHEMA = "sf88.research-study-extraction.native-source.v1"
OPERATION = "DBC61-SCF-STUDY-EXTRACTION-20261012"


def helper_module():
    helper = Path(__file__).absolute().with_name("materialize-europe-pmc-source.py")
    fd = os.open(helper, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Original source receiver must be an ordinary file.")
        raw = stream.read()
    if hashlib.sha256(raw).hexdigest() != HELPER_SHA256:
        raise ValueError("The unchanged original source receiver differs.")
    spec = importlib.util.spec_from_file_location("original_research_source_receiver", helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-envelope", type=Path, required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--expected-bytes", type=int, required=True)
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    receiver = helper_module()
    need, ordinary, digest = receiver.need, receiver.ordinary, receiver.digest
    need(sys.version_info >= (3, 11), "Python 3.11 or later is required.")
    need(args.source_envelope.is_absolute(), "Use an absolute envelope path.")
    need(args.expected_bytes > 0 and len(args.expected_sha256) == 64
         and all(char in "0123456789abcdef" for char in args.expected_sha256),
         "Supply the published complete envelope length and SHA256.")
    raw = ordinary(args.source_envelope)
    need(len(raw) == args.expected_bytes and digest(raw) == args.expected_sha256,
         "The complete selected source envelope differs.")
    envelope = json.loads(raw)
    need(envelope.get("schema") == SCHEMA and envelope.get("operation") == OPERATION,
         "The original programme identity differs.")
    need(envelope.get("repository") == "woahwhattheheck/public-commons-sprint-2026",
         "The composed Research source repository differs.")
    files, inputs = envelope.get("files"), envelope.get("inputs")
    need(isinstance(files, list) and isinstance(inputs, list) and len(inputs) == 3,
         "The complete source and three original input documents are required.")
    need(len(files) == envelope.get("sourceFiles"), "The source member count differs.")
    selected, seen, source_total, input_total = [], set(), 0, 0
    for category, rows in (("source", files), ("input", inputs)):
        for row in rows:
            name = str(receiver.relative(row["path"]))
            need(name not in seen, "Duplicate selected member: " + name)
            seen.add(name)
            need(isinstance(row.get("content"), str), "Complete UTF-8 member content is required.")
            body = row["content"].encode("utf-8")
            need(len(body) == row["bytes"] and digest(body) == row["sha256"],
                 "Selected member length or SHA256 differs: " + name)
            git_blob = row.get("gitBlobSha")
            if git_blob is not None:
                actual_git_blob = hashlib.sha1(
                    b"blob " + str(len(body)).encode("ascii") + b"\0" + body
                ).hexdigest()
                need(actual_git_blob == git_blob, "Original Git blob differs: " + name)
            need(row.get("mode") in ("100644", "100755"), "Unsupported source mode: " + name)
            selected.append((row, body))
            if category == "source":
                source_total += len(body)
            else:
                input_total += len(body)
    need(source_total == envelope.get("sourceBytes") and input_total == envelope.get("inputBytes"),
         "The complete source or input byte total differs.")
    entry = str(receiver.relative(envelope["entry"]))
    need(entry in {row["path"] for row in files}, "The original native entry is absent.")
    roles = {row.get("role"): row for row in inputs}
    need(set(roles) == {"study", "provenance", "projection"}, "The original input roles differ.")
    pins = {
        "study": (99951, "1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1"),
        "provenance": (923, "97e7af80fa105e38307228f657744d6ecd0ac0da20f023ee8677ad01ceef8720"),
        "projection": (22605, "26fe9d252136ec2e2428c2c04dd7afa9f0ab4b5a70b0e8dabc20c8802fe4c093"),
    }
    for role, (length, sha256) in pins.items():
        need((roles[role]["bytes"], roles[role]["sha256"]) == (length, sha256),
             "The retained original " + role + " input differs.")
    root = receiver.directory(args.directory)
    for name in (".citation-source-materialization.json",
                 ".citation-python-source-materialization.json",
                 ".europe-pmc-source-materialization.json"):
        need(not ((root / name).exists() or (root / name).is_symlink()),
             "Use the original NCT source directory and preserve preceding programmes.")
    counts = {"written": 0, "reused": 0}
    for row, body in selected:
        counts[receiver.retain(root / row["path"], body, row["mode"] == "100755")] += 1
    manifest = {
        "schema": "sf88.research-study-extraction.source-materialization.v1",
        "operation": OPERATION,
        "sourceEnvelope": {"bytes": len(raw), "sha256": digest(raw)},
        "repository": envelope["repository"],
        "sourceFiles": len(files), "sourceBytes": source_total,
        "inputFiles": len(inputs), "inputBytes": input_total,
        "directory": str(root), "entry": str(root / entry),
        "inputs": {role: str(root / row["path"]) for role, row in roles.items()},
        "sourceSelection": envelope["sourceSelection"],
        "runtimeRequirements": envelope["runtimeRequirements"],
        "members": [{key: row[key] for key in ("path", "mode", "bytes", "sha256")}
                    for row, _ in selected],
    }
    manifest_body = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    manifest_path = root / ".study-extraction-source-materialization.json"
    receiver.retain(manifest_path, manifest_body)
    for row, body in selected:
        need(ordinary(root / row["path"]) == body,
             "Final selected member readback differs: " + row["path"])
    print(json.dumps({
        "schema": manifest["schema"], "state": "COMPLETE", "operation": OPERATION,
        **counts, "sourceFiles": len(files), "sourceBytes": source_total,
        "inputFiles": len(inputs), "inputBytes": input_total,
        "sourceEnvelopeSha256": digest(raw), "directory": str(root),
        "entry": manifest["entry"], "inputs": manifest["inputs"],
        "manifest": str(manifest_path), "manifestSha256": digest(manifest_body),
    }, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": "STUDY_EXTRACTION_SOURCE_RECEIVING_FAILED",
                          "message": str(error)}), file=sys.stderr)
        sys.exit(1)

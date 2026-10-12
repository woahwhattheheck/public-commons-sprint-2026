#!/usr/bin/env python3
"""Run one retained public-source preservation workflow with upstream BagIt."""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import zipfile

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Original native export ZIP")
    parser.add_argument("--prefix", default="source-export")
    parser.add_argument("--out", required=True)
    parser.add_argument("--bagit-module", help="Exact upstream bagit.py; its installed distribution metadata must be available")
    args = parser.parse_args()
    root = Path(args.out).absolute()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    product_path = Path(__file__).resolve().parents[1] / "preservation.py"
    p = load_module("preservation", product_path)
    source_path = Path(args.source).absolute()
    source_sha = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if (root / "receiving-result.json").exists():
        prior = p.parse_json((root / "receiving-result.json").read_bytes())
        if prior["sourceArchiveSha256"] != source_sha:
            raise ValueError("Existing native journey belongs to another source")
        for name in ("baseline-transfer.zip", "reviewed-transfer.zip", "reverted-transfer.zip"):
            p.verify(root / name)
        p.verify(root / "received")
        print(json.dumps(prior, indent=2))
        return
    if args.bagit_module:
        original_path = Path(args.bagit_module).absolute()
        sys.path.insert(0, str(original_path.parent))
        bagit = load_module("bagit", original_path)
    else:
        import bagit
        original_path = Path(bagit.__file__)
    if str(bagit.VERSION) != "1.9.0":
        raise ValueError("This reproducible exercise selects original BagIt 1.9.0")
    workspace = root / "project"
    p.initialize(source_path, workspace, args.prefix)
    project, prepared = p.project_files(workspace)
    source_review = p.empty_review(prepared)
    records = prepared["records"]
    if len(records) < 2:
        raise ValueError("The public workflow requires at least two original records")
    reviewed = {**source_review, "decisions": [
        {"identifier": records[0]["identifier"], "include": True,
         "fields": {"description": ["Public CC0 example selected to exercise descriptive metadata mapping into Archivematica."]},
         "reason": "Authored evaluation description; original provider values remain in the native source."},
        {"identifier": records[-1]["identifier"], "include": False, "fields": {},
         "reason": "Operator selected a demonstration subset; the complete original edition remains in submission documentation."},
    ], "note": "Public, explicitly authored receiving-example decisions."}
    normalized = p.normalize_review(reviewed, prepared)
    current = p.show(workspace)
    if current["revision"] not in {0, 1, 2}:
        raise ValueError("Original example was edited outside its receiving sequence")
    baseline_path = root / "baseline-transfer.zip"
    if not baseline_path.exists():
        p.build(workspace, baseline_path, 0, zipped=True)
    baseline = p.verify(baseline_path)
    if current["revision"] == 0:
        saved = p.save_review(workspace, reviewed, 0)
        assert saved["revision"] == 1 and not saved["reused"]
        current = p.show(workspace)
    if current["revision"] == 1:
        assert current["review"] == normalized
        replay = p.save_review(workspace, reviewed, 0)
        assert replay["reused"] and replay["revision"] == 1
        if not (root / "reviewed-transfer.zip").exists():
            p.build(workspace, root / "reviewed-transfer.zip", 1, zipped=True)
    else:
        assert current["review"] == source_review and current["revision"] == 2
    reviewed_receipt = p.verify(root / "reviewed-transfer.zip")
    received = p.receive(root / "reviewed-transfer.zip", root / "received")
    reopen = p.receive(root / "reviewed-transfer.zip", root / "received")
    assert reopen["reused"]
    assert bagit.Bag(str(root / "received")).validate(processes=1)
    difference = p.compare(baseline_path, root / "reviewed-transfer.zip")
    assert difference["summary"]["changedRecords"] == 2
    assert reviewed_receipt["includedRecords"] == len(records) - 1
    assert baseline["includedRecords"] == len(records)
    assert reviewed_receipt["sourceRecords"] == len(records)
    current = p.show(workspace)
    if current["revision"] == 1:
        restored = p.save_review(workspace, source_review, 1)
        assert restored["revision"] == 2
    if not (root / "reverted-transfer.zip").exists():
        p.build(workspace, root / "reverted-transfer.zip", 2, zipped=True)
    reverted = p.verify(root / "reverted-transfer.zip")
    assert reverted["includedRecords"] == baseline["includedRecords"]
    assert reverted["bagId"] != baseline["bagId"]
    assert reverted["identity"]["collectionId"] == baseline["identity"]["collectionId"]
    # One actual damaged receiving archive establishes rejection before publish.
    corrupt = root / "damaged-transfer.zip"
    if not corrupt.exists():
        with zipfile.ZipFile(root / "reviewed-transfer.zip") as original, zipfile.ZipFile(
                corrupt, "x", compression=zipfile.ZIP_DEFLATED) as target:
            changed = False
            for item in original.infolist():
                body = original.read(item)
                if not changed and "/data/records/" in item.filename:
                    body += b" "
                    changed = True
                target.writestr(item, body)
            assert changed
    try:
        p.receive(corrupt, root / "damaged-receiving")
        raise AssertionError("The damaged transfer unexpectedly received")
    except p.PreservationError as exc:
        damaged_reason = str(exc)
        assert "Checksum mismatch" in damaged_reason
    assert not (root / "damaged-receiving").exists()
    result = {
        "schema": "stellar-forge.research-preservation-native-example.v1",
        "completedAt": p.utc(), "sourceArchiveSha256": source_sha,
        "sourcePrefix": args.prefix, "sourceBinding": prepared["binding"],
        "sourceRecords": len(records), "sourcePages": len(prepared["binding"]["pages"]),
        "upstreamValidator": {"name": "Library of Congress bagit-python", "version": str(bagit.VERSION),
            "sourceSha256": hashlib.sha256(original_path.read_bytes()).hexdigest(), "valid": True},
        "productSourceSha256": hashlib.sha256(product_path.read_bytes()).hexdigest(),
        "originalOaiSourceSha256": hashlib.sha256(Path(p.oai_module().__file__).read_bytes()).hexdigest(),
        "baseline": baseline, "reviewed": reviewed_receipt, "received": received,
        "reviewReplay": True, "receiveReplay": True, "difference": difference["summary"],
        "reverted": reverted, "damagedTransferRejected": damaged_reason,
        "archives": [{"filename": name, "bytes": (root/name).stat().st_size,
                      "sha256": hashlib.sha256((root/name).read_bytes()).hexdigest()}
                     for name in ("baseline-transfer.zip", "reviewed-transfer.zip", "reverted-transfer.zip")],
    }
    p.write_new(root / "receiving-result.json", p.canonical(result))
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

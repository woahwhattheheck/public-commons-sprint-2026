"""Receive retained original NHD geometry in resumable fresh-link batches.

Run from the application directory with python -m source_tools.hydrate_nhd_originals.
The complete receiver consumes output/originals via --download-directory.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.error
import urllib.request

from source_tools.resume_nhd_originals import unpack_bank, verify_page, member, valid_ids


def read_json(path):
    return json.loads(Path(path).read_bytes())


def atomic_json(path, value):
    raw = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    handle, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def sha_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def identity(record, metadata):
    return hashlib.sha256(json.dumps({
        "filename": record["filename"], "bytes": record["bytes"],
        "requested_ids": record["requested_ids"],
        "request_sha256": record["request_file"]["sha256"], "metadata": metadata,
    }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def checked(path, record, metadata, cached=None):
    if path.stat().st_size != record["bytes"]:
        raise ValueError("Original byte count differs")
    digest = sha_file(path)
    if record.get("sha256") and digest != record["sha256"]:
        raise ValueError("Original published SHA256 differs")
    token = identity(record, metadata)
    if not cached or cached.get("sha256") != digest or cached.get("identity") != token:
        result = verify_page(path, record["requested_ids"], metadata)
        if result["sha256"] != digest:
            raise ValueError("Original changed during validation")
    return {"identity": token, "sha256": digest, "bytes": record["bytes"],
            "native_ids": len(record["requested_ids"])}


def receive(record, source, destination, metadata):
    handle, name = tempfile.mkstemp(prefix="." + record["filename"] + ".", dir=destination)
    temporary = Path(name)
    try:
        if source.startswith("https://"):
            request = urllib.request.Request(source, headers={"Accept": "application/json"})
            opened = urllib.request.urlopen(request, timeout=180)
        elif "://" in source:
            raise ValueError("Use an HTTPS URL or a retained local original")
        else:
            opened = Path(source).open("rb")
        with os.fdopen(handle, "wb") as output:
            handle = None
            with opened as input_stream:
                count = 0
                while True:
                    block = input_stream.read(1024 * 1024)
                    if not block:
                        break
                    count += len(block)
                    if count > record["bytes"]:
                        raise ValueError("Response exceeds original byte count")
                    output.write(block)
            output.flush()
            os.fsync(output.fileno())
        result = checked(temporary, record, metadata)
        target = destination / record["filename"]
        os.replace(temporary, target)
        return result
    finally:
        if handle is not None:
            os.close(handle)
        temporary.unlink(missing_ok=True)


def message(error):
    # Signed URLs stay in the supplied mapping, never the progress log.
    if isinstance(error, urllib.error.HTTPError):
        return "HTTP " + str(error.code) + "; refresh this retained-file URL"
    if isinstance(error, urllib.error.URLError):
        return "Original download failed: " + type(error.reason).__name__
    return type(error).__name__ + ": " + str(error).split("https://", 1)[0][:240]


def run(args):
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    lock = (root / ".hydration.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise ValueError("A downloader is already writing this output directory")
    try:
        return hydrate(args, root)
    finally:
        lock.close()


def hydrate(args, root):
    bank_dir = root / "banks" / args.bank_sha256
    bank_dir.mkdir(parents=True, exist_ok=True)
    manifest = unpack_bank(args.bank, args.bank_sha256, bank_dir)
    metadata = read_json(member(bank_dir, manifest["metadata"]["path"]))
    pages = manifest["native_geometry_pages"]
    names, ids = set(), set()
    for record in pages:
        name = record["filename"]
        if not name or Path(name).name != name or name in names:
            raise ValueError("Original geometry filenames must be unique basenames")
        names.add(name)
        current = valid_ids(record["requested_ids"])
        if ids & current:
            raise ValueError("Original geometry requests overlap")
        ids.update(current)
        request = read_json(member(bank_dir, record["request_file"]["path"]))
        if request.get("ids") != record["requested_ids"]:
            raise ValueError("Original request differs from its retained page")
    originals = root / "originals"
    originals.mkdir(exist_ok=True)
    index_path = root / "hydration-index.json"
    index = read_json(index_path) if index_path.exists() else {"schema": "upstate.nhd-hydration/v1", "files": {}}
    if index.get("schema") != "upstate.nhd-hydration/v1" or not isinstance(index.get("files"), dict):
        raise ValueError("Unexpected hydration index")
    downloads = read_json(args.downloads) if args.downloads else {}
    if not isinstance(downloads, dict) or any(not isinstance(v, str) for v in downloads.values()):
        raise ValueError("Download mapping must map original filename to HTTPS URL or local path")
    unknown = set(downloads) - names
    if unknown:
        raise ValueError("Download mapping contains filenames outside this source bank")
    failed, pending, accepted, quarantined = [], [], set(), []
    for record in pages:
        path = originals / record["filename"]
        if path.exists():
            try:
                index["files"][record["filename"]] = checked(
                    path, record, metadata, index["files"].get(record["filename"]))
                accepted.add(record["filename"])
            except (ValueError, KeyError, TypeError, OSError) as error:
                quarantine = root / "invalid-originals"
                quarantine.mkdir(exist_ok=True)
                target = quarantine / (record["filename"] + "." + sha_file(path))
                os.replace(path, target)
                index["files"].pop(record["filename"], None)
                quarantined.append({"filename": record["filename"],
                                    "retained_invalid_body": str(target), "error": message(error)})
                pending.append(record)
        else:
            pending.append(record)
    atomic_json(index_path, index)
    available = [r for r in pending if r["filename"] in downloads]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(receive, r, downloads[r["filename"]], originals, metadata): r
                   for r in available}
        for future in as_completed(futures):
            record = futures[future]
            try:
                result = future.result()
                index["files"][record["filename"]] = result
                accepted.add(record["filename"])
                atomic_json(index_path, index)
                print(json.dumps({"received": record["filename"], **result}), flush=True)
            except Exception as error:
                failed.append({"filename": record["filename"], "error": message(error)})
    remaining = [r for r in pages if r["filename"] not in accepted]
    catalog = [{"filename": r["filename"], "bytes": r["bytes"],
                "reference": r["stable_reference"], "file_upload_id": r.get("file_upload_id")}
               for r in remaining]
    batches = [catalog[i:i + 25] for i in range(0, len(catalog), 25)]
    atomic_json(root / "remaining-downloads.json", {
        "schema": "upstate.nhd-download-catalog/v1", "source_bank_sha256": args.bank_sha256,
        "remaining_files": len(catalog), "batches": batches,
    })
    report = {
        "schema": "upstate.nhd-hydration-summary/v1", "source_bank_sha256": args.bank_sha256,
        "source_revision": manifest.get("revision"), "complete": not remaining,
        "source_files": len(pages), "source_native_ids": len(ids),
        "received_files": len(accepted),
        "received_bytes": sum(r["bytes"] for r in pages if r["filename"] in accepted),
        "remaining_files": len(remaining), "failed": failed, "quarantined": quarantined,
        "download_directory": str(originals),
        "next_reference_catalog": str(root / "remaining-downloads.json"),
    }
    atomic_json(root / "hydration-summary.json", report)
    print(json.dumps(report, indent=2, sort_keys=True), flush=True)
    return 1 if failed else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", required=True)
    parser.add_argument("--bank-sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--downloads", help="Fresh filename-to-HTTPS mapping for any remaining batch")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args(argv)
    if len(args.bank_sha256) != 64 or any(c not in "0123456789abcdef" for c in args.bank_sha256):
        parser.error("Choose the published lowercase source-bank SHA256")
    if not 1 <= args.workers <= 8:
        parser.error("Choose 1..8 concurrent original downloads")
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Receive retained NC ambient originals and compile their exact CSV/ZIP records."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from source_tools.receive_nc_ambient_sources import (
    CAPTURE_SCHEMA, digest_file, receive, relative_name, verify_identity,
)

SCHEMA = "upstate.nc-ambient-hydration/v1"
EDITION = "nc-ambient-hydration-20261013-v1"
CHUNK = 1024 * 1024


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def atomic_json(path, value):
    descriptor, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def deadline(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("The existing operation cutoff needs an explicit timezone")
    return parsed.astimezone(timezone.utc)


def within_cutoff(cutoff):
    if datetime.now(timezone.utc) >= cutoff:
        raise RuntimeError("The original operation cutoff has arrived; retained sources remain in place")


def unwrap(value):
    for _ in range(12):
        if not isinstance(value, dict) or value.get("isError") is True:
            raise ValueError("Original source resolver did not return a successful object")
        if isinstance(value.get("structuredContent"), dict):
            value = value["structuredContent"]
            continue
        blocks = value.get("content")
        if isinstance(blocks, list):
            candidates = []
            for block in blocks:
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    try:
                        candidates.append(json.loads(block["text"]))
                    except ValueError:
                        pass
            if len(candidates) == 1 and isinstance(candidates[0], dict):
                value = candidates[0]
                continue
        return value
    raise ValueError("Original source resolver wrapper nesting exceeded its supported depth")


def hosted_module(path):
    """Use the receiving worker's existing current official helper unchanged."""
    if path:
        selected = Path(path).expanduser().resolve(strict=True)
        spec = importlib.util.spec_from_file_location("nc_ambient_existing_hosted_apps", selected)
        if spec is None or spec.loader is None:
            raise ValueError("Choose the actual existing hosted-app helper")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    return importlib.import_module("library_hosted_apps")


def resolver_binding(client, module):
    """Find only the normal Notion action in the current native tool catalogue."""
    cursor = None
    seen = set()
    for _ in range(100):
        result = client._rpc("tools/list", {} if cursor is None else {"cursor": cursor})
        if not isinstance(result, dict) or not isinstance(result.get("tools"), list):
            raise ValueError("Current native discovery returned no tools array")
        matches = []
        for row in result["tools"]:
            if not isinstance(row, dict):
                continue
            name, meta = row.get("name"), row.get("_meta")
            if not isinstance(name, str) or not isinstance(meta, dict):
                continue
            normalized = name.replace("-", "_").replace(".", "_")
            if not (normalized.endswith("notion_get_file_download_urls")
                    or normalized == "get_file_download_urls"):
                continue
            connector = next((meta[key] for key in
                ("connector_id", "connectorId", "app_id", "appId")
                if isinstance(meta.get(key), str) and meta[key]), None)
            if connector is None:
                continue
            properties = row.get("inputSchema", {}).get("properties", {})
            if properties and "references" not in properties:
                raise ValueError("Current original-source resolver schema differs")
            client._tools.append(module.HostedAppTool(name=name, meta=meta))
            matches.append((connector, name))
        if len(set(matches)) > 1:
            raise ValueError("Current native source resolver is ambiguous")
        if matches:
            return matches[0]
        cursor = result.get("nextCursor", result.get("next_cursor"))
        if not cursor:
            break
        if not isinstance(cursor, str) or cursor in seen:
            raise ValueError("Current native source catalogue repeated its cursor")
        seen.add(cursor)
    raise ValueError("Current native tools did not expose the original Notion download resolver")


def resolve(client, binding, entries):
    references = [entry["retained_file_uri"] for entry in entries]
    if len(set(references)) != len(references):
        raise ValueError("Each retained original needs its own stable file reference")
    returned = unwrap(client.call_tool(binding[0], binding[1], {"references": references}))
    if not isinstance(returned.get("files"), list):
        raise ValueError("Original source resolver returned no files array")
    resolved = {}
    for row in returned["files"]:
        if not isinstance(row, dict):
            raise ValueError("Original source resolver returned a malformed file")
        reference, url = row.get("reference"), row.get("url")
        if (reference not in references or reference in resolved
                or not isinstance(url, str) or not url.startswith("https://")):
            raise ValueError("Original resolved source identity differs")
        resolved[reference] = url
    if set(resolved) != set(references):
        missing = [entry["id"] for entry in entries
                   if entry["retained_file_uri"] not in resolved]
        raise ValueError("Original references remain unresolved: " + ", ".join(missing))
    return resolved


def download(entry, url, destination, cutoff):
    """Keep a complete validated original, never a partially downloaded filename."""
    target = destination / relative_name(entry["filename"])
    if not target.parent.resolve().is_relative_to(destination):
        raise ValueError("Original download parent escapes this source directory")
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix="." + target.name + ".", dir=target.parent)
    temporary = Path(name)
    try:
        digest, count = hashlib.sha256(), 0
        request = urllib.request.Request(url, headers={"Accept": "*/*"})
        with os.fdopen(descriptor, "wb") as output:
            descriptor = None
            with urllib.request.urlopen(request, timeout=60) as response:
                while True:
                    within_cutoff(cutoff)
                    body = response.read(CHUNK)
                    if not body:
                        break
                    count += len(body)
                    if count > entry["expected_bytes"]:
                        raise ValueError("Original download exceeds its captured byte count")
                    output.write(body)
                    digest.update(body)
            output.flush()
            os.fsync(output.fileno())
        identity = {"bytes": count, "sha256": digest.hexdigest()}
        verify_identity(identity, entry, entry["id"])
        # The owner lock serializes this directory. link() also refuses an
        # unexpected destination created independently during the download.
        os.link(temporary, target)
        return identity
    except urllib.error.HTTPError as error:
        raise RuntimeError("Original download HTTP " + str(error.code)
                           + "; rerun this same operation for a fresh retained-file URL") from None
    except urllib.error.URLError as error:
        raise RuntimeError("Original download failed: " + type(error.reason).__name__) from None
    finally:
        if descriptor is not None:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)


def run(args):
    cutoff = deadline(args.cutoff)
    within_cutoff(cutoff)
    capture_path = args.capture.expanduser().resolve(strict=True)
    capture_bytes = capture_path.read_bytes()
    capture = json.loads(capture_bytes.decode("utf-8-sig"))
    entries = capture.get("entries") if isinstance(capture, dict) else None
    if (not isinstance(capture, dict) or capture.get("schema") != CAPTURE_SCHEMA
            or not isinstance(entries, list) or not entries):
        raise ValueError("Choose the complete original NC ambient capture manifest")
    ids, names, references = set(), set(), set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Each original capture entry must be an object")
        identifier = entry.get("id")
        if not isinstance(identifier, str) or not identifier or identifier in ids:
            raise ValueError("Original capture IDs must be unique nonempty strings")
        filename = relative_name(entry.get("filename")).as_posix()
        reference = entry.get("retained_file_uri")
        if (filename in names or reference in references or not isinstance(reference, str)
                or not reference.startswith("notion-file-block://")):
            raise ValueError("Retain unique original filenames and stable Notion references")
        verify_identity({"bytes": entry.get("expected_bytes"), "sha256": entry.get("sha256")},
                        entry, identifier)
        ids.add(identifier)
        names.add(filename)
        references.add(reference)
    root = args.source_directory.expanduser().absolute()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root = root.resolve(strict=True)
    output = args.output.expanduser().absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    output = output.parent.resolve(strict=True) / output.name
    if output.exists() or output.is_symlink():
        raise FileExistsError("Compiled output already exists; continue its retained inventory or choose a new output")
    if output == root or root in output.parents or output in root.parents:
        raise ValueError("Keep the downloaded originals and compiled output separate")
    lock_path = root / ".nc-ambient-hydration.lock"
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        capture_sha = hashlib.sha256(capture_bytes).hexdigest()
        identity_path = root / ".nc-ambient-capture.json"
        if identity_path.exists():
            retained = json.loads(identity_path.read_bytes())
            if retained != {"schema": SCHEMA, "capture_sha256": capture_sha}:
                raise ValueError("This receiving directory belongs to another original capture")
        else:
            atomic_json(identity_path, {"schema": SCHEMA, "capture_sha256": capture_sha})
        index_path = root / ".nc-ambient-originals.json"
        index = (json.loads(index_path.read_bytes()) if index_path.exists()
                 else {"schema": SCHEMA, "capture_sha256": capture_sha, "files": {}})
        if (index.get("schema") != SCHEMA or index.get("capture_sha256") != capture_sha
                or not isinstance(index.get("files"), dict)):
            raise ValueError("The existing original download index differs")
        pending = []
        for entry in entries:
            path = root / relative_name(entry["filename"])
            if path.is_symlink():
                raise ValueError("Retain original downloads as regular local files")
            if path.exists():
                if not path.is_file() or not path.resolve().is_relative_to(root):
                    raise ValueError("Original file path is not contained in this source directory")
                identity = digest_file(path)
                verify_identity(identity, entry, entry["id"])
                prior = index["files"].get(entry["id"])
                if prior and prior != identity:
                    raise ValueError("An already received original changed: " + entry["id"])
                index["files"][entry["id"]] = identity
            else:
                pending.append(entry)
        atomic_json(index_path, index)
        if pending:
            module = hosted_module(args.hosted_apps_helper)
            client = module.HostedAppsClient()
            binding = resolver_binding(client, module)
            for offset in range(0, len(pending), 25):
                within_cutoff(cutoff)
                batch = pending[offset:offset + 25]
                urls = resolve(client, binding, batch)
                try:
                    for entry in batch:
                        within_cutoff(cutoff)
                        identity = download(entry, urls[entry["retained_file_uri"]], root, cutoff)
                        index["files"][entry["id"]] = identity
                        atomic_json(index_path, index)
                        print(json.dumps({"stage": "original_received", "id": entry["id"],
                                          **identity}, sort_keys=True), flush=True)
                finally:
                    urls.clear()
        within_cutoff(cutoff)
        if capture_path.read_bytes() != capture_bytes:
            raise ValueError("The original capture manifest changed during receiving")
        result = receive(root, capture_path, output, args.encoding)
        result["hydration"] = {"schema": SCHEMA, "edition": EDITION,
                               "capture_sha256": capture_sha,
                               "originals": str(root), "files": index["files"]}
        atomic_json(root / ".nc-ambient-completed.json", result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--source-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--hosted-apps-helper",
                        help="Actual current official library_hosted_apps.py on this receiving worker")
    parser.add_argument("--encoding", default="utf-8-sig")
    parser.add_argument("--cutoff", default="2026-10-13T14:00:00Z")
    args = parser.parse_args(argv)
    os.umask(0o077)
    # The unchanged CSV compiler applies this for its own CLI; this entry point
    # calls its public receive() directly and preserves that same CSV capacity.
    import csv
    csv.field_size_limit(sys.maxsize)
    result = run(args)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Continue the original OSF 2sz48 source intake using its 17 observed version URLs."""
from __future__ import annotations
import argparse, base64, datetime, fcntl, hashlib, json, os, stat, tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

OPERATION = "OSF-4SCIENCE-TRANSITION-RECEIVING-E9B2-20261012"
SCHEMA = "commons.osf-2sz48.original-intake.v1"

def need(value, message):
    if not value:
        raise RuntimeError(message)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def directory(path):
    path = Path(path)
    try:
        info = path.lstat()
        need(stat.S_ISDIR(info.st_mode), "Use an original real directory: " + str(path))
    except FileNotFoundError:
        directory(path.parent)
        path.mkdir(mode=0o700)
        sync_dir(path.parent)

def original(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode), "Use a complete regular original file.")
        chunks = []
        while True:
            chunk = os.read(fd, 262144)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "An original retained file changed while reading.")
        raw = b"".join(chunks)
        need(len(raw) == after.st_size, "The complete original file length changed.")
        return raw
    finally:
        os.close(fd)

def retain(path, raw):
    path = Path(path)
    directory(path.parent)
    try:
        need(original(path) == raw, "Different original bytes already occupy " + str(path))
        sync_dir(path.parent)
        return
    except FileNotFoundError:
        pass
    fd, staged = tempfile.mkstemp(prefix="." + path.name + ".receiving-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(staged, path, follow_symlinks=False)
        except FileExistsError:
            need(original(path) == raw, "The original destination changed during publication.")
        sync_dir(path.parent)
    finally:
        os.unlink(staged)
        sync_dir(path.parent)

def checkpoint(path, value):
    raw = encoded(value)
    fd, staged = tempfile.mkstemp(prefix=".checkpoint-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staged, path)
        sync_dir(path.parent)
    finally:
        if os.path.exists(staged):
            os.unlink(staged)

class PublicRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        need(target.scheme == "https" and not target.username and not target.password,
             "The original public source redirected outside HTTPS.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def checked_file(raw, item):
    need(len(raw) == item["bytes"], "The original version length differs: " + item["name"])
    need(sha(raw) == item["sha256"], "The original version SHA256 differs: " + item["name"])
    need(hashlib.md5(raw).hexdigest() == item["md5"], "The original version MD5 differs: " + item["name"])

def fetch(opener, url, maximum, accept):
    target = urlsplit(url)
    need(target.scheme == "https" and not target.username and not target.password,
         "Use the retained original public HTTPS source.")
    request = Request(url, headers={"Accept": accept, "User-Agent": "Commons-OSF-original-receiving/1.0"})
    try:
        with opener.open(request, timeout=45) as response:
            raw = response.read(maximum + 1)
            need(len(raw) <= maximum, "The source exceeded its declared receiving bound.")
            return raw, {"status": response.status, "url": url, "received_at": now(),
                         "content_type": response.headers.get("Content-Type"), "bytes": len(raw),
                         "sha256": sha(raw)}
    except HTTPError as error:
        raw = error.read(2097152)
        return raw, {"status": error.code, "url": url, "received_at": now(),
                     "content_type": error.headers.get("Content-Type"), "bytes": len(raw),
                     "sha256": sha(raw)}

def run(args):
    input_raw = original(Path(args.input))
    packet = json.loads(input_raw)
    need(packet.get("schema") == SCHEMA and packet.get("operation_id") == OPERATION
         and packet.get("node_id") == "2sz48", "Continue the same original OSF operation.")
    documents, manifest = packet["documents"], packet["files"]
    need(len(manifest) == 17 and sum(item["bytes"] for item in manifest) == 397352,
         "The selected original file cohort changed.")
    keys = [(item["node_id"], item["provider"], item["file_id"], item["version_id"]) for item in manifest]
    need(len(set(keys)) == 17 and all(key[0] == "2sz48" and key[1] == "osfstorage" for key in keys),
         "Use the original unique version identities.")
    root = Path(args.directory).absolute()
    directory(root)
    root = root.resolve()
    lock = os.open(root / "original-intake.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        retain(root / "original-input.json", input_raw)
        state_path = root / "original-intake.json"
        try:
            state = json.loads(original(state_path))
        except FileNotFoundError:
            state = {"schema": SCHEMA + ".receipt", "operation_id": OPERATION,
                     "input_sha256": sha(input_raw), "created_at": now(), "state": "RECEIVING",
                     "files": {}, "checks": {}, "attempts": []}
        need(state["operation_id"] == OPERATION and state["input_sha256"] == sha(input_raw),
             "A different original input owns this receiving directory.")
        checkpoint(state_path, state)
        opener = build_opener(PublicRedirects())
        retained = []
        for item in manifest:
            key = "/".join([item["node_id"], item["provider"], item["file_id"], item["version_id"]])
            filename = "files/" + item["sha256"] + ".bin"
            destination = root / filename
            try:
                raw = original(destination)
                checked_file(raw, item)
            except FileNotFoundError:
                attempt = {"kind": "file", "key": key, "url": item["download_url"],
                           "started_at": now(), "state": "STARTED"}
                state["attempts"].append(attempt)
                checkpoint(state_path, state)
                try:
                    raw, receipt = fetch(opener, item["download_url"], item["bytes"] + 1048576,
                                         "application/octet-stream,*/*")
                    retain(root / "attempts" / (str(len(state["attempts"])) + ".body"), raw)
                    attempt.update(receipt)
                    need(receipt["status"] == 200, "Original version returned HTTP " + str(receipt["status"]))
                    checked_file(raw, item)
                    retain(destination, raw)
                    attempt["state"] = "COMPLETE"
                except Exception as error:
                    attempt.update(state="FAILED", error=str(error), finished_at=now())
                    checkpoint(state_path, state)
                    raise
            state["files"][key] = {"content_file": filename, "sha256": sha(raw), "bytes": len(raw)}
            checkpoint(state_path, state)
            retained.append({key: value for key, value in item.items() if key != "metadata_url"} |
                            {"content_file": filename})
            print(json.dumps({"original_version": key, "bytes": len(raw), "sha256": sha(raw)}), flush=True)
        checks = [{"role": "node-check", "node_id": "2sz48", "url": "https://api.osf.io/v2/nodes/2sz48/"}]
        checks += [{"role": "file-check", "node_id": item["node_id"], "owner_id": item["file_id"],
                    "provider": item["provider"], "url": item["metadata_url"]} for item in manifest]
        for descriptor in checks:
            key = descriptor["role"] + ":" + descriptor.get("owner_id", descriptor["node_id"])
            saved = state["checks"].get(key)
            if saved is None:
                attempt = {"kind": "after-check", "key": key, "url": descriptor["url"],
                           "started_at": now(), "state": "STARTED"}
                state["attempts"].append(attempt)
                checkpoint(state_path, state)
                try:
                    raw, receipt = fetch(opener, descriptor["url"], 2097152, "application/vnd.api+json")
                    relative = "checks/" + sha(raw) + ".json"
                    retain(root / relative, raw)
                    attempt.update(receipt)
                    need(receipt["status"] == 200, "Final original metadata returned HTTP " + str(receipt["status"]))
                    body = json.loads(raw)
                    expected_id = descriptor.get("owner_id", descriptor["node_id"])
                    need(body.get("data", {}).get("id") == expected_id, "Final source identity changed.")
                    saved = descriptor | {"phase": "after", "status": 200, "body_file": relative,
                                          "bytes": len(raw), "sha256": sha(raw),
                                          "capture_method": "Original complete HTTPS response"}
                    state["checks"][key] = saved
                    attempt["state"] = "COMPLETE"
                    checkpoint(state_path, state)
                except Exception as error:
                    attempt.update(state="FAILED", error=str(error), finished_at=now())
                    checkpoint(state_path, state)
                    raise
            raw = original(root / saved["body_file"])
            need(len(raw) == saved["bytes"] and sha(raw) == saved["sha256"], "Retained final metadata changed.")
        source = {"schema": "osf-project-source/v1", "roots": ["2sz48"],
                  "created_at": state["created_at"], "source_mode": "original-public-research-source",
                  "documents": documents + list(state["checks"].values()), "files": retained,
                  "findings": packet.get("findings", []),
                  "original_receiving_operation": OPERATION}
        source_raw = encoded(source)
        retain(root / "source-manifest.json", source_raw)
        state.update(state="COMPLETE", completed_at=state.get("completed_at") or now(),
                     source_manifest={"name": "source-manifest.json", "bytes": len(source_raw),
                                      "sha256": sha(source_raw)})
        checkpoint(state_path, state)
        print(json.dumps({"state": "COMPLETE", "operation_id": OPERATION,
                          "source": str(root / "source-manifest.json"), "files": len(retained),
                          "file_bytes": sum(item["bytes"] for item in retained),
                          "documents": len(source["documents"]), "sha256": sha(source_raw)}), flush=True)
        return state
    finally:
        os.close(lock)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--directory", required=True)
    args = parser.parse_args()
    run(args)

if __name__ == "__main__":
    main()

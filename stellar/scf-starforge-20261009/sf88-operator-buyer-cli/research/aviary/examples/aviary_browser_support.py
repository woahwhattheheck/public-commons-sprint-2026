#!/usr/bin/env python3
"""Source-bound support for the original Aviary browser receiving journey.

Reads original review history and validates original queued output with the
maintained application. resume-job is the sole write-capable recovery action:
it completes the original INTERRUPTED job at its already-published output path,
after the original application server has drained. It never creates a new job,
changes a mapping, calls a provider, or rewrites the original job record.
"""
from __future__ import annotations
import argparse
import copy
import csv
import fcntl
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import zipfile

SCHEMA = "commons.aviary.browser-support.v2"
SOURCE_FILES = ("aviary.py", "aviary_client.py", "server.py", "index.html",
                "app.js", "cli.mjs", "README.md", "PROVIDER_CONTRACT.md",
                "managed.py", "APPLICATIONS.md")

def require(condition, message):
    if not condition:
        raise ValueError(message)

def read_json(filename, limit=16 * 1024 * 1024):
    raw = Path(filename).read_bytes()
    require(len(raw) <= limit, "Retained JSON exceeds receiving bounds")
    return json.loads(raw), raw

def file_record(filename):
    target = Path(filename)
    require(not target.is_symlink(), "Expected an original regular file")
    with target.open("rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode), "Expected a regular file")
        digest = hashlib.sha256()
        count = 0
        while True:
            block = stream.read(256 * 1024)
            if not block:
                break
            count += len(block)
            digest.update(block)
        after = os.fstat(stream.fileno())
    for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"):
        require(getattr(before, field) == getattr(after, field),
                "Original file changed during verification")
    require(count == before.st_size, "Original byte count differs")
    return {"path": str(target.resolve()), "bytes": count,
            "sha256": digest.hexdigest()}

def hold_lock(filename):
    target = Path(filename)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(target, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode), "Receiving lock is not a regular file")
        current = target.stat()
        require((info.st_dev, info.st_ino) == (current.st_dev, current.st_ino),
                "Receiving lock identity changed")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps({"state": "LOCKED", "pid": os.getpid()}), flush=True)
        while sys.stdin.buffer.read(4096):
            pass
    finally:
        os.close(fd)

def application(request):
    app = Path(request["application"]).resolve(strict=True)
    root = Path(request["workspace"]).resolve(strict=True)
    require(app.is_dir() and root.is_dir(), "Original application/workspace absent")
    require((root / "aviary.sqlite3").is_file(), "Original Aviary database absent")
    sys.path.insert(0, str(app))
    a = importlib.import_module("aviary")
    require(Path(a.__file__).resolve() == app / "aviary.py",
            "Imported a different Aviary application")
    return a, app, root

def original_mapping(a, root, revision=None):
    with a.connect(root) as db:
        return a.mapping(db, revision)

def expected_keys(a, root, before):
    current = original_mapping(a, root, int(before["revision"]))
    require(a.digest(current["document"]) == a.digest(before["document"]),
            "Original assignment preimage differs from saved review history")
    review = copy.deepcopy(before["document"])
    tables = a.mapped_tables(root, review)
    for kind, field in (("resources", "Resource User Key"),
                        ("media", "Media User Key")):
        assignments = review.setdefault("keyMaps", {}).setdefault(kind, {})
        source_keys = [
            a.effective_values(kind, review["tables"][kind],
                               row["source"]["values"])[field]
            for row in tables[kind]
        ]
        require(all(source_keys) and len(source_keys) == len(set(source_keys)),
                "Original source keys are empty or duplicated")
        used = set(assignments.values()) | {
            key for key in source_keys if a.KEY.fullmatch(key)
        }
        candidate = 1000
        for original in source_keys:
            if original in assignments or a.KEY.fullmatch(original):
                continue
            while str(candidate) in used and candidate <= 9999:
                candidate += 1
            require(candidate <= 9999, "Original user-key range is exhausted")
            assignments[original] = str(candidate)
            used.add(str(candidate))
    review["note"] = (review.get("note", "") +
                     "\nAssigned Aviary user keys from retained original identifiers.").strip()
    return {"document": review, "mappingSha256": a.digest(review),
            "beforeSha256": a.digest(before["document"]),
            "expectedRevision": int(before["revision"]) +
            (a.digest(review) != a.digest(before["document"]))}

def mapping_evidence(a, root, request):
    before = request["before"]
    expected = request["expectedDocument"]
    body = request["request"]
    require(isinstance(expected, dict), "Expected original saved document absent")
    require(body.get("expectedRevision") == before["revision"],
            "Original request revision differs")
    if "document" in body:
        require(a.digest(body["document"]) == a.digest(expected),
                "Original request document differs")
    with a.connect(root) as db:
        retained_before = a.mapping(db, int(before["revision"]))
        require(a.digest(retained_before["document"]) == a.digest(before["document"]),
                "Original saved preimage differs")
        current = a.mapping(db)
        revision = int(before["revision"]) + (
            a.digest(expected) != a.digest(before["document"]))
        row = db.execute("SELECT revision FROM reviews WHERE revision=?", (revision,)).fetchone()
        if row is None:
            require(current["revision"] == before["revision"],
                    "Current review advanced outside the retained request")
            return {"committed": False, "currentMapping": current,
                    "expectedRevision": revision}
        saved = a.mapping(db, revision)
        if a.digest(saved["document"]) != a.digest(expected):
            if revision == before["revision"]:
                raise ValueError("Original unchanged-document request differs")
            raise ValueError("A different review occupies the requested revision")
        return {"committed": True, "mapping": saved,
                "mappingSha256": a.digest(saved["document"]),
                "beforeSha256": a.digest(retained_before["document"]),
                "currentMapping": current}

def queued_job(a, root, request):
    expected = request["job"]
    jobs_file = root / "operator-jobs.json"
    jobs, raw = read_json(jobs_file)
    require(isinstance(jobs, list), "Original job journal is not an array")
    matches = [job for job in jobs if job.get("id") == expected.get("id")]
    require(len(matches) == 1, "Original queued job is absent or duplicated")
    actual = matches[0]
    for key in ("id", "kind", "arguments", "created"):
        require(actual.get(key) == expected.get(key),
                "Original queued job binding differs: " + key)
    kind = actual["kind"]
    require(kind in ("native-package", "workspace-export"),
            "Unsupported original browser job kind")
    arguments = actual.get("arguments", {})
    output = Path(arguments.get("output", ""))
    require(output.is_absolute(), "Original queued output is not absolute")
    directory = root.parent / (root.name + "-deliveries")
    require(output.parent.resolve() == directory.resolve(),
            "Original queued output is outside its delivery directory")
    prefix = "Aviary_Native_Package_" if kind == "native-package" else "Aviary_Complete_Workspace_"
    require(output.name.startswith(prefix) and output.name.endswith(".zip"),
            "Original queued output name differs")
    selection = request["selection"]
    require(selection["workspaceId"] == a.show(root)["workspace"]["id"],
            "Original queued workspace identity differs")
    revision = int(selection["revision"])
    retained = original_mapping(a, root, revision)
    require(a.digest(retained["document"]) == selection["mappingSha256"],
            "Original queued mapping fingerprint differs")
    model = a.preview(root, revision)
    require(model["sourceManifestSha256"] == selection["sourceManifestSha256"],
            "Original queued source fingerprint differs")
    if kind == "native-package":
        supplied = arguments.get("revision")
        require(supplied is None or int(supplied) == revision,
                "Original native package selection differs")
    return actual, output, model, {"path": str(jobs_file),
                                  "bytes": len(raw),
                                  "sha256": hashlib.sha256(raw).hexdigest()}

def native_files(a, root, model):
    rows, assets = a.package_rows(root, model)
    files = []
    for kind in a.KINDS:
        extra = sorted(set().union(*(set(row) for row in rows[kind])) -
                       set(a.FIELDS[kind]))
        fields = list(a.FIELDS[kind]) + extra
        text = io.StringIO(newline="")
        writer = csv.DictWriter(text, fieldnames=fields, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows[kind])
        raw = text.getvalue().encode("utf-8")
        files.append({"path": "aviary-package/" + a.FILENAMES[kind],
                      "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    for destination, item in sorted(assets.items()):
        source = a.within(root / "source", item["path"])
        actual = file_record(source)
        require(actual["bytes"] == item["bytes"] and actual["sha256"] == item["sha256"],
                "Original packaged asset changed")
        files.append({"path": "aviary-package/" + destination,
                      "bytes": item["bytes"], "sha256": item["sha256"]})
    return files

def verify_native(a, root, output, model, selection):
    files = native_files(a, root, model)
    a.verify_zip(output, files)
    descriptor = file_record(output)
    expected = {"schema": "stellar-forge.aviary-package.v1",
                "revision": int(selection["revision"]),
                "mappingSha256": selection["mappingSha256"],
                "sourceManifestSha256": selection["sourceManifestSha256"],
                "counts": model["counts"], "files": files,
                "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}
    sidecar = output.with_suffix(output.suffix + ".manifest.json")
    sidecar_record = None
    if sidecar.exists():
        saved, raw = read_json(sidecar)
        for key, value in expected.items():
            require(saved.get(key) == value, "Original package sidecar differs: " + key)
        sidecar_record = {"path": str(sidecar), "bytes": len(raw),
                          "sha256": hashlib.sha256(raw).hexdigest()}
    return {"output": str(output), **expected, "file": descriptor,
            "sidecar": sidecar_record,
            "verification": "ORIGINAL_ZIP_AND_SIDECAR" if sidecar_record else
                            "ORIGINAL_ZIP_RECONSTRUCTED_FROM_ORIGINAL_SELECTED_ROWS"}

def verify_handoff(a, app, root, output, selection, expected_application):
    with zipfile.ZipFile(output) as archive:
        require(archive.namelist().count("MANIFEST.json") == 1,
                "Original handoff manifest is absent or duplicated")
        raw = archive.read("MANIFEST.json")
        require(len(raw) <= 16 * 1024 * 1024, "Original manifest is too large")
        manifest = json.loads(raw)
        require(manifest.get("schema") == "stellar-forge.aviary-handoff.v1" and
                manifest.get("workspaceId") == selection["workspaceId"],
                "Original handoff identity differs")
        entries = manifest["files"] + [{
            "path": "MANIFEST.json", "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest()}]
        a.verify_zip(output, entries)
        names = set(archive.namelist())
        required = {"workspace/aviary.sqlite3", "workspace/source-manifest.json",
                    "delivery/preview.json", "delivery/status.json",
                    "delivery/native-package-manifest.json",
                    "delivery/review.html", "DELIVERY.md", "MANIFEST.json"}
        required.update("application/" + name for name in SOURCE_FILES)
        require(required.issubset(names), "Original complete handoff omits its source/runtime")
        status_value = json.loads(archive.read("delivery/status.json"))
        preview = json.loads(archive.read("delivery/preview.json"))
        require(status_value["workspace"]["id"] == selection["workspaceId"],
                "Original handoff status workspace differs")
        require(status_value["mapping"]["revision"] == int(selection["revision"]) and
                a.digest(status_value["mapping"]["document"]) == selection["mappingSha256"],
                "Original handoff review differs")
        require(preview["sourceManifestSha256"] == selection["sourceManifestSha256"] and
                preview["mappingSha256"] == selection["mappingSha256"],
                "Original handoff source/selection fingerprints differ")
        require(len(expected_application) == len(SOURCE_FILES),
                "Original application inventory is incomplete")
        for descriptor in expected_application:
            require(descriptor["path"] in SOURCE_FILES, "Unexpected application member")
            body = archive.read("application/" + descriptor["path"])
            require(len(body) == descriptor["bytes"] and
                    hashlib.sha256(body).hexdigest() == descriptor["sha256"],
                    "Original handoff application member differs")
        members = len(entries)
    descriptor = file_record(output)
    return {"output": str(output), "schema": manifest["schema"],
            "workspaceId": manifest["workspaceId"], "members": members,
            "bytes": descriptor["bytes"], "sha256": descriptor["sha256"],
            "file": descriptor, "mapping": status_value["mapping"],
            "verification": "ORIGINAL_COMPLETE_MANIFEST_AND_SOURCE_BYTES"}

def active_original_servers(root):
    found = []
    for item in Path("/proc").iterdir():
        if not item.name.isdigit() or int(item.name) == os.getpid():
            continue
        try:
            fields = (item / "cmdline").read_bytes().split(b"\0")
            values = [part.decode("utf-8", "strict") for part in fields if part]
            if "serve" in values and "--workspace" in values:
                index = values.index("--workspace") + 1
                if index < len(values) and Path(values[index]).resolve() == root:
                    found.append(int(item.name))
        except (OSError, UnicodeError, ValueError):
            continue
    return found

def job_action(a, app, root, request):
    with a.locked(root):
        job, output, model, journal = queued_job(a, root, request)
        if request["action"] == "resume-job" and not output.exists():
            require(job.get("state") == "INTERRUPTED",
                    "Only an original interrupted queued output may be resumed")
            require(not active_original_servers(root),
                    "Original workspace server must drain before queued-output completion")
            if job["kind"] == "workspace-export":
                current = original_mapping(a, root)
                require(current["revision"] == int(request["selection"]["revision"]) and
                        a.digest(current["document"]) == request["selection"]["mappingSha256"],
                        "A later operator review must not be included in the original export")
            # Core methods acquire the same original project lock themselves.
            # Drop this short read lock before calling them; all identities are
            # rechecked in the second lock below before the result is accepted.
            resume = True
        else:
            resume = False
    if resume:
        if job["kind"] == "native-package":
            a.build_package(root, output, int(request["selection"]["revision"]))
        else:
            a.export_workspace(root, output)
    with a.locked(root):
        current_job, same_output, same_model, same_journal = queued_job(a, root, request)
        require(same_output == output, "Original queued output changed")
        if not output.exists():
            return {"state": "MISSING", "job": current_job,
                    "output": str(output), "jobJournal": same_journal}
        require(not output.is_symlink(), "Original output is not a regular archive")
        if current_job["kind"] == "native-package":
            verified = verify_native(a, root, output, same_model, request["selection"])
        else:
            verified = verify_handoff(a, app, root, output, request["selection"],
                                      request["applicationSource"])
        result = current_job.get("result")
        if result:
            for key in ("bytes", "sha256"):
                if key in result:
                    require(result[key] == verified[key],
                            "Original queued result differs from its retained archive")
        return {"state": "VERIFIED", "job": current_job,
                "jobJournal": same_journal, "archive": verified,
                "completedOriginalInterruptedOutput": resume}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hold-lock")
    parser.add_argument("--request")
    args = parser.parse_args()
    if args.hold_lock:
        require(not args.request, "Select one support action")
        hold_lock(args.hold_lock)
        return
    require(args.request, "A retained support request is required")
    request, _ = read_json(args.request)
    require(request.get("schema") == SCHEMA, "Unknown browser support schema")
    a, app, root = application(request)
    a.verify_source(root)
    action = request["action"]
    if action == "inspect":
        value = {"status": a.show(root), "preview": a.preview(root)}
    elif action == "expected-keys":
        value = expected_keys(a, root, request["before"])
    elif action == "mapping-evidence":
        value = mapping_evidence(a, root, request)
    elif action == "preview":
        value = a.preview(root, int(request["revision"]))
    elif action in ("verify-job", "resume-job"):
        value = job_action(a, app, root, request)
    else:
        raise ValueError("Unknown browser support action")
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")), flush=True)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"state": "FAILED", "error": type(error).__name__,
                          "message": str(error)}, ensure_ascii=False), file=sys.stderr, flush=True)
        raise SystemExit(2)

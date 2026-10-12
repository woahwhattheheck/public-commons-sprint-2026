#!/usr/bin/env python3
"""Run the complete original research-to-RODA receiving operation.

Python 3.11+, Java 17+, standard library only. Uses the official Commons-IP
2.12.1 release JAR and the complete original public 169-record research input.
The REST stage uses a local implementation of the reviewed RODA source API.
"""
import argparse
import base64
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

OPERATION = "RODA-RESEARCH-RECEIVING-6BA15-20261012"
SCHEMA = "stellar-forge.roda-whole-receiving.v1"
PACKET_SCHEMA = "stellar-forge.roda-whole-receiving-input.v1"
INPUT_NAME = "OpenAlex_CIIM_Source_Example_20261012.zip"
INPUT_BYTES = 145901
INPUT_SHA = "948c5c85a3ec88cf26ab9bae2ebcda284ea429dfa3c8240ac2565e30b278f77b"
JAR_URL = "https://github.com/keeps/commons-ip/releases/download/2.12.1/commons-ip2-cli-2.12.1.jar"
JAR_BYTES = 10899616
JAR_SHA = "8783b83d43763f068a081c66a084f8bfe05594ba24c56d3bf931ac4b6b639c5d"

def encode(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False,
                       separators=(",", ":")) + "\n").encode("utf-8")

def descriptor(path):
    h, size = hashlib.sha256(), 0
    with Path(path).open("rb") as handle:
        while body := handle.read(1024 * 1024):
            h.update(body)
            size += len(body)
    return {"bytes": size, "sha256": h.hexdigest()}

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def write_new(path, body):
    path = Path(path)
    require(not path.is_symlink(), "Refusing a symlink: " + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.is_file() and path.read_bytes() == body,
                "Existing original file has different bytes: " + str(path))
        return
    # Match the maintained producer's exclusive, atomic immutable publication.
    fd, temporary_name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            require(not path.is_symlink() and path.is_file() and path.read_bytes() == body,
                    "Concurrent original publication has different bytes: " + str(path))
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary.exists():
            temporary.unlink()

def save_new(path, value):
    write_new(path, encode(value))

def safe_path(root, name):
    parts = PurePosixPath(name)
    require(isinstance(name, str) and name and not parts.is_absolute()
            and str(parts) == name and all(p not in (".", "..") for p in parts.parts)
            and "\\" not in name, "Invalid packet member: " + repr(name))
    target = root.joinpath(*parts.parts)
    for item in (root, *target.relative_to(root).parents):
        candidate = item if item.is_absolute() else root / item
        require(not candidate.is_symlink(), "Packet parent is a symlink: " + str(candidate))
    require(not target.is_symlink(), "Packet target is a symlink: " + str(target))
    return target

def materialize(packet, root):
    require(packet.get("schema") == PACKET_SCHEMA and packet.get("operationId") == OPERATION,
            "Select the original complete RODA receiving packet")
    files = packet.get("files")
    require(isinstance(files, list) and len(files) == 12, "Expected the twelve complete source/input files")
    names = set()
    inventory = []
    for item in files:
        name = item["path"]
        require(name not in names, "Duplicate receiving packet member: " + name)
        names.add(name)
        encoding = item["encoding"]
        require(encoding in ("utf-8", "base64"), "Unsupported receiving member encoding")
        body = (item["content"].encode("utf-8") if encoding == "utf-8"
                else base64.b64decode(item["content"], validate=True))
        actual = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
        require(actual == {"bytes": item["bytes"], "sha256": item["sha256"]},
                "Receiving input bytes differ: " + name)
        write_new(safe_path(root, name), body)
        inventory.append({"path": name, **actual})
    required = {
        "application/research/preservation/roda.py",
        "application/research/preservation/roda_client.py",
        "application/research/preservation/preservation.py",
        "application/research/preservation/cli.mjs",
        "application/research/preservation/README.md",
        "application/research/preservation/RODA.md",
        "application/research/preservation/RODA_REST.md",
        "application/research/oai/oai_feed.py",
        "receiving/run_roda_receiving.py",
        "receiving/run_roda_rest_receiving.py",
        "receiving/ReceiveRodaBag.java",
        "input/" + INPUT_NAME,
    }
    require(names == required, "The receiving application closure differs")
    require(descriptor(root / "input" / INPUT_NAME) == {"bytes": INPUT_BYTES, "sha256": INPUT_SHA},
            "The original public research input differs")
    return inventory

def jar_file(root, supplied):
    target = Path(supplied).absolute() if supplied else root / "runtime/commons-ip2-cli-2.12.1.jar"
    if target.exists() or target.is_symlink():
        require(not target.is_symlink() and target.is_file(), "Select an ordinary original JAR")
        require(descriptor(target) == {"bytes": JAR_BYTES, "sha256": JAR_SHA},
                "Installed Commons-IP JAR differs from the official 2.12.1 release")
        return target
    require(not supplied, "The supplied original Commons-IP JAR does not exist")
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=".commons-ip-", dir=target.parent)
    temporary = Path(temporary_name)
    try:
        count = 0
        request = urllib.request.Request(JAR_URL, headers={"User-Agent": "Commons-RODA-Receiving/1.0"})
        with os.fdopen(fd, "wb") as handle, urllib.request.urlopen(request, timeout=60) as response:
            require(response.status == 200, "Official Commons-IP release download did not succeed")
            while body := response.read(1024 * 1024):
                count += len(body)
                require(count <= JAR_BYTES, "Official JAR response exceeds the pinned release length")
                handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        require(descriptor(temporary) == {"bytes": JAR_BYTES, "sha256": JAR_SHA},
                "Official Commons-IP release download differs from its published digest")
        os.rename(temporary, target)
        return target
    finally:
        if temporary.exists():
            temporary.unlink()

def run_logged(argv, directory, label, timeout):
    started = time.time()
    stdout_path, stderr_path = directory / (label + ".stdout.txt"), directory / (label + ".stderr.txt")
    with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
        try:
            result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                    cwd=directory, timeout=timeout, check=False)
            code, error = result.returncode, None
        except subprocess.TimeoutExpired as exc:
            code, error = None, str(exc)
        stdout.flush()
        stderr.flush()
        os.fsync(stdout.fileno())
        os.fsync(stderr.fileno())
    observation = {"argv": [str(x) for x in argv], "startedAt": started,
                   "seconds": time.time() - started, "returncode": code,
                   "stdout": {"path": str(stdout_path), **descriptor(stdout_path)},
                   "stderr": {"path": str(stderr_path), **descriptor(stderr_path)}}
    if error:
        observation["error"] = error
    save_new(directory / (label + "-invocation.json"), observation)
    require(code == 0, label + " failed; retain and read " + str(directory / (label + "-invocation.json")))
    return observation

def read_json(path):
    return json.loads(Path(path).read_bytes())

def artifact(root, path):
    return {"path": str(Path(path).relative_to(root)), **descriptor(path)}

def reopen(root, expected_packet):
    result_path = root / "receiving-result.json"
    if not result_path.exists():
        return None
    result = read_json(result_path)
    require(result.get("schema") == SCHEMA and result.get("completed") is True
            and result.get("operationId") == OPERATION and result.get("packet") == expected_packet,
            "Existing whole receiving result belongs to another operation or source")
    for item in result["artifacts"]:
        actual = descriptor(safe_path(root, item["path"]))
        require(actual == {"bytes": item["bytes"], "sha256": item["sha256"]},
                "Retained whole receiving artifact differs: " + item["path"])
    return result

def summarize(root, result, reused):
    return {"operationId": OPERATION, "completed": True, "reused": reused,
            "result": str(root / "receiving-result.json"),
            "delivery": str(root / result["delivery"]["path"]),
            "deliverySha256": result["delivery"]["sha256"],
            "records": result["records"], "parsedFiles": result["parser"]["fileCount"],
            "uploadPosts": result["rest"]["uploadPosts"], "jobPosts": result["rest"]["jobPosts"]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--jar", help="Existing exact official Commons-IP2.12.1 release JAR")
    parser.add_argument("--original-bag", help="Reuse the verified original all-selected 169-record BagIt ZIP")
    parser.add_argument("--java", default="java")
    parser.add_argument("--command-timeout", type=int, default=600)
    args = parser.parse_args()
    require(sys.version_info >= (3, 11), "Use Python 3.11 or later")
    require(args.command_timeout > 0, "Command timeout must be positive")
    packet_path = Path(args.packet).absolute()
    packet_bytes = packet_path.read_bytes()
    packet = json.loads(packet_bytes)
    packet_descriptor = {"bytes": len(packet_bytes), "sha256": hashlib.sha256(packet_bytes).hexdigest()}
    root = Path(args.root).absolute()
    require(not root.is_symlink(), "Select an ordinary owned receiving directory")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / ".receiving.lock").open("ab") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        completed = reopen(root, packet_descriptor)
        if completed:
            if args.original_bag:
                require(descriptor(Path(args.original_bag)) == completed["originalBag"],
                        "Selected original BagIt differs from the completed receiving operation")
            print(json.dumps(summarize(root, completed, True)))
            return
        write_new(root / "original-receiving-packet.json", packet_bytes)
        inventory = materialize(packet, root)
        java = shutil.which(args.java)
        require(java is not None, "Install Java17+ or supply its exact executable with --java")
        jar = jar_file(root, args.jar)
        attempts = root / "attempts"
        attempts.mkdir(exist_ok=True)
        numbers = [int(p.name) for p in attempts.iterdir() if p.is_dir() and p.name.isdigit()]
        attempt = attempts / ("%04d" % (max(numbers, default=0) + 1))
        attempt.mkdir()
        started = time.time()
        save_new(attempt / "started.json", {"operationId": OPERATION, "packet": packet_descriptor,
                 "startedAt": started, "attempt": attempt.name, "sourceInventory": inventory})
        try:
            version = subprocess.run([java, "-version"], stdin=subprocess.DEVNULL, capture_output=True,
                                     timeout=30, check=True)
            java_version = (version.stdout + version.stderr).decode("utf-8", errors="replace")
            save_new(attempt / "runtime.json", {"python": sys.version, "executable": sys.executable,
                     "platform": platform.platform(), "java": java_version,
                     "jar": {"path": str(jar), **descriptor(jar)}, "javaMaxHeap": "256m"})
            source_dir = root / "application/research/preservation"
            sys.path.insert(0, str(source_dir))
            import preservation as preservation
            import roda as producer
            native_source = root / "input" / INPUT_NAME
            original_bag = root / "original-research-transfer.zip"
            if args.original_bag:
                supplied = Path(args.original_bag).absolute()
                require(not supplied.is_symlink() and supplied.is_file(),
                        "Select the original regular research BagIt ZIP")
                checked = preservation.verify(supplied)
                profile = checked["identity"].get("sourceProfile", {})
                require(checked["sourceRecords"] == 169 and checked["includedRecords"] == 169
                        and checked["excludedRecords"] == 0 and checked["identity"]["reviewRevision"] == 0,
                        "The selected original transfer is not the completed all-selected baseline")
                require(profile.get("archiveSha256") == INPUT_SHA and profile.get("archiveBytes") == INPUT_BYTES,
                        "Selected original BagIt does not retain the exact complete public input")
                write_new(original_bag, supplied.read_bytes())
                require(preservation.verify(original_bag) == checked,
                        "The retained original BagIt changed during receiving")
                original = {**checked, "path": str(original_bag), "reused": True}
                before = {"reusedOriginalTransfer": str(supplied),
                          "revision": checked["identity"]["reviewRevision"],
                          "sourceRecords": checked["sourceRecords"],
                          "includedRecords": checked["includedRecords"],
                          "excludedRecords": checked["excludedRecords"],
                          "sourceProfile": profile}
            else:
                research_workspace = root / "original-research-workspace"
                before = preservation.initialize(native_source, research_workspace, "source-export",
                             organization="Commons public-source RODA receiving",
                             contact="Local receiving operator")
                require(before["sourceRecords"] == 169 and before["includedRecords"] == 169
                        and before["excludedRecords"] == 0 and before["revision"] == 0,
                        "Original all-selected 169-record research review differs")
                original = preservation.build(research_workspace, original_bag,
                                              expected_revision=0, zipped=True)
            agreement = producer.agreement_template()
            agreement.update({"agreementId": OPERATION,
                              "notes": "Local receiving of the actual public 169-record research collection."})
            agreement["repository"].update({"name": "Local RODA source-contract receiving",
                                            "baseUrl": "http://127.0.0.1:18080"})
            agreement["producer"].update({"name": "Commons public-source receiving operator",
                                          "contact": "Local operation " + OPERATION})
            agreement["collection"].update({"title": "Original 169-record public research collection",
                "description": "Complete original metadata, reviewed selection and byte-identical original BagIt transfer."})
            agreement_path = root / "local-submission-agreement.json"
            save_new(agreement_path, agreement)
            workspace = attempt / "prepared-workspace"
            prepared = producer.prepare(original_bag, agreement_path, workspace)
            handoff = producer.show(workspace)
            require(handoff == prepared["handoff"], "Prepared handoff changed when reopened")
            require(handoff["records"] == {"source": 169, "included": 169, "excluded": 0},
                    "RODA record inventory differs")
            repeated = producer.prepare(original_bag, agreement_path, workspace)
            require(repeated["reused"] is True and repeated["handoff"] == handoff,
                    "Preparing the same original transfer did not reuse its handoff")
            verified = producer.verify_transfer(workspace / "transfer.zip")
            original_descriptor = descriptor(original_bag)
            require(handoff["originalTransfer"]["sha256"] == original_descriptor["sha256"]
                    and handoff["originalTransfer"]["bytes"] == original_descriptor["bytes"],
                    "The complete original BagIt archive differs in the RODA handoff")
            save_new(attempt / "producer-result.json", {
                "source": descriptor(native_source), "originalReview": before,
                "originalBag": original, "handoff": handoff, "standaloneVerification": verified,
                "repeatedPreparationReused": True})
            java_result_path = attempt / "upstream-parser-result.json"
            java_call = run_logged([java, "-Xmx256m", "--class-path", str(jar),
                str(root / "receiving/ReceiveRodaBag.java"), str(workspace / "transfer.zip"),
                str(attempt / "parsed-representation"), str(java_result_path)],
                attempt, "upstream-parser", args.command_timeout)
            parsed = read_json(java_result_path)
            require(parsed["completed"] is True
                    and parsed["transferSha256"] == handoff["transfer"]["sha256"],
                    "The actual Commons-IP parser result is not for the original prepared SIP")
            # The JVM has exited before the local HTTP process starts.
            rest_out = attempt / "repository-receiving"
            rest_call = run_logged([sys.executable, str(root / "receiving/run_roda_rest_receiving.py"),
                "--client", str(source_dir / "roda_client.py"), "--workspace", str(workspace),
                "--out", str(rest_out)], attempt, "repository", args.command_timeout)
            rest_result_path = rest_out / "receiving-result.json"
            rest = read_json(rest_result_path)
            require(rest["uploadPosts"] == 1 and rest["jobPosts"] == 1 and not rest["serverErrors"],
                    "The complete REST recovery journey did not retain its original upload and job")
            require(rest["originalTransfer"] == handoff["transfer"], "The REST journey used another SIP")
            require(producer.show(workspace) == handoff, "Original prepared package changed during receiving")
            snapshot = rest_out / "completed-repository-snapshot.zip"
            require(snapshot.is_file(), "The complete received application/workspace snapshot is missing")
            result = {"schema": SCHEMA, "operationId": OPERATION, "completed": True,
                      "packet": packet_descriptor, "attempt": attempt.name,
                      "startedAt": started, "seconds": time.time() - started,
                      "sourceInventory": inventory, "records": handoff["records"],
                      "source": descriptor(native_source), "originalBag": original_descriptor,
                      "handoffId": handoff["id"], "transfer": handoff["transfer"],
                      "parser": parsed, "rest": {
                          "operationId": rest["operationId"], "ids": rest["ids"],
                          "uploadPosts": rest["uploadPosts"], "jobPosts": rest["jobPosts"],
                          "stages": len(rest["stages"]), "requestCount": rest["requestCount"],
                          "credentialProjectionVerified": rest["credentialProjectionVerified"]},
                      "runtime": read_json(attempt / "runtime.json")}
            save_new(attempt / "whole-operation-result.json", result)
            delivery_path = root / ("RODA_Research_Complete_Receiving_" + attempt.name + ".zip")
            delivery_guide = """# Complete RODA research receiving

The main RODA_Complete_Application_and_Workspace.zip contains the complete
operating application, the original 169-record research BagIt, the prepared
RODA SIP, the entered agreement and the repository operation journal.

Use the maintained application to receive the inner snapshot into a new directory:

    python3 research/preservation/roda.py receive --source RODA_Complete_Application_and_Workspace.zip --output received
    python3 received/application/research/preservation/roda.py show --workspace received/workspace

The included RODA.md and RODA_REST.md explain live repository configuration,
actual operator authentication, job template selection, approval/appraisal,
reconciliation and portable workspace receiving. The original agreement and
journal in this package belong to the local receiving endpoint. A live repository
gets its own entered agreement and prepared workspace through the same application.

The receiving directory carries the exact source/input packet, all three native
receiving programs, original producer result, actual upstream Java parser result,
and the complete HTTP recovery journey. Commons-IP2.12.1 parsed the submitted SIP;
the local HTTP server exercised the reviewed RODA API, lost-reply recovery,
all original report/AIP states, and full export/receive with one upload and one job.

To reproduce the complete local operation on a Linux host with Python3.11+ and
Java17+, use the included original-receiving-packet.json and run_roda_receiving.py:

    python3 receiving/run_roda_receiving.py --packet receiving/original-receiving-packet.json --root new-roda-receiving

The runner accepts --jar for an existing exact Commons-IP2.12.1 release JAR.
Otherwise it downloads and verifies the official pinned release. An already
completed operation reopens its saved result and verifies all final artifacts.
Interrupted attempts remain in the original operation directory for inspection.

MANIFEST.json gives the complete outer delivery inventory and exact member digests.
"""
            write_new(attempt / "DELIVERY.md", delivery_guide.encode("utf-8"))
            members = {
                "DELIVERY.md": attempt / "DELIVERY.md",
                "RODA_Complete_Application_and_Workspace.zip": snapshot,
                "receiving/whole-operation-result.json": attempt / "whole-operation-result.json",
                "receiving/producer-result.json": attempt / "producer-result.json",
                "receiving/upstream-parser-result.json": java_result_path,
                "receiving/repository-result.json": rest_result_path,
                "receiving/runtime.json": attempt / "runtime.json",
                "receiving/upstream-parser-invocation.json": attempt / "upstream-parser-invocation.json",
                "receiving/repository-invocation.json": attempt / "repository-invocation.json",
                "receiving/upstream-parser.stdout.txt": attempt / "upstream-parser.stdout.txt",
                "receiving/upstream-parser.stderr.txt": attempt / "upstream-parser.stderr.txt",
                "receiving/repository.stdout.txt": attempt / "repository.stdout.txt",
                "receiving/repository.stderr.txt": attempt / "repository.stderr.txt",
                "receiving/run_roda_receiving.py": root / "receiving/run_roda_receiving.py",
                "receiving/run_roda_rest_receiving.py": root / "receiving/run_roda_rest_receiving.py",
                "receiving/ReceiveRodaBag.java": root / "receiving/ReceiveRodaBag.java",
                "receiving/original-receiving-packet.json": root / "original-receiving-packet.json",
            }
            delivery_manifest = {"schema": SCHEMA + ".delivery", "operationId": OPERATION,
                "handoffId": handoff["id"],
                "files": {name: descriptor(path) for name, path in sorted(members.items())}}
            with zipfile.ZipFile(delivery_path, "x", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as archive:
                for name, path in sorted(members.items()):
                    archive.write(path, name,
                                  compress_type=zipfile.ZIP_STORED if name.endswith(".zip") else zipfile.ZIP_DEFLATED)
                archive.writestr("MANIFEST.json", encode(delivery_manifest))
            with zipfile.ZipFile(delivery_path) as archive:
                require(archive.testzip() is None, "Complete receiving delivery ZIP failed CRC verification")
                for name, expected in delivery_manifest["files"].items():
                    body = archive.read(name)
                    require({"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()} == expected,
                            "Final delivery member changed: " + name)
            result["delivery"] = artifact(root, delivery_path)
            result["artifacts"] = [artifact(root, path) for path in (
                snapshot, java_result_path, rest_result_path, attempt / "whole-operation-result.json", delivery_path)]
            save_new(root / "receiving-result.json", result)
            print(json.dumps(summarize(root, result, False)))
        except BaseException as exc:
            error_path = attempt / "receiving-error.json"
            if not error_path.exists():
                save_new(error_path, {"operationId": OPERATION, "packet": packet_descriptor,
                    "attempt": attempt.name, "seconds": time.time() - started,
                    "errorType": type(exc).__name__, "error": str(exc),
                    "retainedDirectory": str(attempt)})
            raise

if __name__ == "__main__":
    main()

"""MIT. One retained Environmental Data Retrieval operator/browser/customer receiving lifetime.

Use the original closed native workspace and its actual source packets. The
browser owns no provider acquisition. Both HTTP services and native Workspace
leases are closed before the independent customer workspace is reopened.
"""
from __future__ import annotations
import argparse
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import zipfile

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode()

def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            h.update(block)
    return h.hexdigest()

def save(path, value):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(encoded(value)); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def load(path, default=None):
    return json.loads(Path(path).read_bytes()) if Path(path).exists() else default

def report_failure(stage, error, **details):
    # Error reporting must not replace the original application or cleanup error.
    try:
        print(json.dumps({"stage": stage, "error": {"type": type(error).__name__,
                         "message": str(error)[:2000]}, **details}), file=sys.stderr, flush=True)
    except BaseException:
        pass

def retain_failure_result(path, public):
    try:
        save(path, public)
    except BaseException as error:
        report_failure("EDR_RESULT_PRESERVATION_FAILED", error, result=str(path))

def private_dir(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.is_symlink():
        raise ValueError("Keep the retained operation in an actual private directory")
    if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise ValueError("The operation directory must be private and owned by this operator")
    return path.resolve()

def lock_owner(path):
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    stream = os.fdopen(os.open(path, flags, 0o600), "r+b", buffering=0)
    if os.name == "posix":
        import fcntl
        try:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            stream.close()
            raise RuntimeError("This original browser continuation already has an owner")
    else:
        import msvcrt
        if os.fstat(stream.fileno()).st_size == 0:
            stream.write(b"\0")
        stream.seek(0)
        try:
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            stream.close()
            raise RuntimeError("This original browser continuation already has an owner")
    return stream

def source_manifest(root):
    names = ["edr_source.py", "edr_workspace.py", "edr_server.py", "cli.py", "cli.mjs",
             "public/index.html", "public/app.js", "public/style.css",
             "delivery/browser-owner.py", "delivery/browser-phase.cjs"]
    return {name: {"bytes": (root / name).stat().st_size, "sha256": digest(root / name)} for name in names}

def start_server(OperatorServer, workspace, port, name):
    server = OperatorServer(workspace, port=port)
    thread = threading.Thread(target=server.serve_forever, name=name)
    try:
        thread.start()
    except BaseException:
        server.server_close()
        raise
    return server, thread

def close_owned(servers, workspaces):
    errors = []
    while servers:
        server, thread = servers.pop()
        try:
            server.shutdown(); server.server_close(); thread.join(timeout=10)
            if thread.is_alive():
                raise RuntimeError("Original HTTP worker has not closed")
        except BaseException as error:
            errors.append({"kind": type(error).__name__, "message": str(error)})
    while workspaces:
        workspace = workspaces.pop()
        try:
            workspace.close()
        except BaseException as error:
            errors.append({"kind": type(error).__name__, "message": str(error)})
    return errors

def stop_child(child):
    if child and child.poll() is None:
        try:
            if os.name == "posix":
                os.killpg(child.pid, signal.SIGTERM)
            else:
                child.terminate()
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            if os.name == "posix":
                os.killpg(child.pid, signal.SIGKILL)
            else:
                child.kill()
            child.wait(timeout=10)

def verify_exports(output, result):
    verified = []
    for item in result.get("exports", []):
        name = item.get("file")
        if not isinstance(name, str) or Path(name).name != name:
            raise ValueError("Unexpected retained export name")
        path = output / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size != item["bytes"] or digest(path) != item["sha256"]:
            raise ValueError("Retained export changed: " + name)
        members = {}
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) != len({i.filename for i in infos}):
                raise ValueError("Duplicate retained export member")
            for info in infos:
                mode = info.external_attr >> 16
                if (info.filename != info.orig_filename or info.filename.startswith("/") or
                    ".." in Path(info.filename).parts or "\\" in info.filename or
                    info.flag_bits & 1 or info.is_dir() or stat.S_ISLNK(mode)):
                    raise ValueError("Unexpected retained export member")
                h = hashlib.sha256(); count = 0
                with archive.open(info) as stream:
                    for block in iter(lambda: stream.read(65536), b""):
                        h.update(block); count += len(block)
                members[info.filename] = {"bytes": count, "sha256": h.hexdigest()}
            index = item["sourceIndex"]
            build = result["builds"][index]
            if item["kind"] == "dataset":
                if set(members) != {"data.csv", "dataset.json", "edr-lineage.json"}:
                    raise ValueError("Seller dataset export is incomplete")
                lineage = json.loads(archive.read("edr-lineage.json"))
                if (lineage.get("schema") != "stellar-forge.edr-lineage.v1" or
                    lineage["snapshot"] != build["snapshot"] or lineage["build"] != build["id"] or
                    lineage["rowCount"] != build["rowCount"]):
                    raise ValueError("Dataset lineage differs from its retained edition")
                if lineage["files"] != {n: build["files"][n] for n in ("data.csv", "dataset.json")}:
                    raise ValueError("Dataset lineage differs from the two exported native files")
                if hashlib.sha256(encoded(lineage["mapping"])).hexdigest() != build["plan"]:
                    raise ValueError("Dataset lineage differs from the original reviewed mapping")
            elif item["kind"] == "project":
                expected = {"manifest.json", "source.edr", "plan.json", "data.csv", "dataset.json", "review.json"}
                if set(members) != expected:
                    raise ValueError("Customer project must contain all six original files")
                manifest = json.loads(archive.read("manifest.json"))
                if manifest["build"] != build["id"] or manifest["files"] != {n: v for n, v in members.items() if n != "manifest.json"}:
                    raise ValueError("Customer packet manifest differs from its original members")
                if members["source.edr"]["sha256"] != build["source"] or members["plan.json"]["sha256"] != build["plan"]:
                    raise ValueError("Customer packet lost its original source or mapping")
            else:
                raise ValueError("Unknown original export kind")
            for name in ("data.csv", "dataset.json"):
                if members[name] != build["files"][name]:
                    raise ValueError("Exported native cells/configuration differ from the completed build")
        verified.append({**item, "members": members})
    return verified


def completed_owner(root, output, workspace, receiver, args, public):
    """Adopt a fully saved identical execution before opening any native service."""
    if public.get("status") != "EDR_OPERATOR_RECEIVING_COMPLETE":
        return None
    generations = public.get("generations", [])
    if not generations or generations[-1].get("state") != "complete":
        raise ValueError("The completed owner is missing its original generation")
    generation = generations[-1]
    if generation.get("sourceFiles") != source_manifest(root):
        return None
    intent = load(output / "browser-intent.json")
    if (not isinstance(intent, dict) or intent.get("schema") != "stellar-forge.edr-browser-intent.v1" or
        intent.get("workspace") != str(workspace) or intent.get("receiverWorkspace") != str(receiver.resolve()) or
        intent.get("inputs", {}).get("coveragePolicy") != args.coverage_policy):
        raise ValueError("The completed browser belongs to different original inputs or coverage")
    identity = intent["inputs"]
    if hashlib.sha256(encoded(identity)).hexdigest() != intent.get("inputManifestSha256"):
        raise ValueError("The completed input manifest changed")
    rows = identity.get("sources")
    if not isinstance(rows, list) or not rows:
        raise ValueError("The completed owner must retain its source selection")
    selected = list(args.source_packet) or [workspace / "sources" / (row["sha256"] + ".edr") for row in rows]
    inputs = {}
    for packet in selected:
        packet = Path(packet).absolute()
        if packet.is_symlink() or not packet.is_file():
            raise ValueError("The completed source packet must remain an original regular file")
        inputs[digest(packet)] = packet.stat().st_size
    if inputs != {row["sha256"]: row["bytes"] for row in rows}:
        raise ValueError("The completed source selection differs from this invocation")
    fact = public.get("result", {})
    result_path = output / "browser-result.json"
    if (fact.get("file") != result_path.name or not result_path.is_file() or result_path.is_symlink() or
        result_path.stat().st_size != fact.get("bytes") or digest(result_path) != fact.get("sha256")):
        raise ValueError("The completed original browser result changed")
    result = load(result_path)
    required = ["original-workspace", "edition-comparison", "complete-records", "original-layout", "customer-layout"]
    for index in range(len(rows)):
        required.extend(["source-" + str(index), "native-" + str(index), "customer-" + str(index)])
    if (result.get("status") != "EDR_BROWSER_COMPLETE" or result.get("coveragePolicy") != args.coverage_policy or
        result.get("inputManifestSha256") != intent["inputManifestSha256"] or
        set(result.get("completed", [])) != set(required) or
        any(len(result.get(name, [])) != len(rows) for name in ("sources", "builds", "receiving"))):
        raise ValueError("The completed browser lacks an original receiving phase")
    for index, row in enumerate(rows):
        build, received = result["builds"][index], result["receiving"][index]
        if (build["id"] != row["build"] or received["build"] != row["build"] or
            any(value["source"] != row["sha256"] or value["plan"] != row["plan"] or
                value["snapshot"] != row["snapshot"] for value in (build, received))):
            raise ValueError("The completed receiving identities changed")
    if len(result.get("exports", [])) != 3 * len(rows):
        raise ValueError("The completed source and customer exports are incomplete")
    verify_exports(output, result)
    files = [*result.get("originalFiles", []), *generation.get("completionFiles", [])]
    if not generation.get("completionFiles"):
        raise ValueError("The completed native/CLI output identities are missing")
    for item in files:
        name = item.get("file")
        if not isinstance(name, str) or Path(name).name != name:
            raise ValueError("The completed output path differs")
        path = output / name
        if (path.is_symlink() or not path.is_file() or path.stat().st_size != item["bytes"] or
            digest(path) != item["sha256"]):
            raise ValueError("A completed original output changed: " + name)
    return {"status": public["status"], "result": str(output / "owner-result.json"),
            "sources": len(rows), "completedResultAdopted": True,
            "inputManifestSha256": intent["inputManifestSha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--operation-root", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True, help="The original closed native workspace")
    parser.add_argument("--source-packet", type=Path, action="append", default=[])
    parser.add_argument("--coverage-policy", choices=("require-exhausted", "allow-partial"), default="require-exhausted",
                        help="Explicit reviewed acquisition-coverage choice, retained in every browser checkpoint")
    parser.add_argument("--temporary-root", type=Path)
    parser.add_argument("--screenshots", action="store_true", help="Keep internal local QA images")
    args = parser.parse_args()
    root = args.source_root.resolve(strict=True)
    if not (root / "edr_workspace.py").is_file():
        raise ValueError("Select the complete maintained Environmental Data Retrieval source directory")
    operation = private_dir(args.operation_root)
    output = private_dir(operation / "browser")
    workspace = args.workspace.resolve(strict=True)
    receiver = operation / "browser-receiving-workspace"
    if workspace == receiver.resolve():
        raise ValueError("Independent customer receiving requires its separate saved workspace")
    with lock_owner(output / "owner.lock"):
        child = None
        servers, workspaces = [], []
        result_path = output / "owner-result.json"
        public = load(result_path, {"schema": "stellar-forge.edr-browser-owner.v1", "generations": []})
        completed = completed_owner(root, output, workspace, receiver, args, public)
        if completed is not None:
            print(json.dumps(completed), flush=True)
            return
        generation = {"startedAt": utc(), "pid": os.getpid(), "state": "starting", "coveragePolicy": args.coverage_policy}
        public["generations"].append(generation)
        primary_error = None
        def retain_primary(error):
            nonlocal primary_error
            if primary_error is None:
                primary_error = error
                report_failure("EDR_ORIGINAL_OWNER_FAILED", error, result=str(result_path))
        def drain_lifetime(exc_type=None, error=None, traceback=None):
            # Preserve the original error before cleanup or a failed result save.
            if error is not None:
                retain_primary(error)
            closing = []
            try:
                stop_child(child)
            except BaseException as cleanup_error:
                closing.append({"operation": "stop_child", "kind": type(cleanup_error).__name__,
                                "message": str(cleanup_error)})
            try:
                closing.extend(close_owned(servers, workspaces))
            except BaseException as cleanup_error:
                closing.append({"operation": "close_owned", "kind": type(cleanup_error).__name__,
                                "message": str(cleanup_error)})
            if closing:
                generation.setdefault("cleanupErrors", []).extend(closing)
                public["status"] = "RETAINED_FOR_CONTINUATION"
                cleanup_error = RuntimeError("Original browser/service cleanup did not complete: " + json.dumps(closing))
                report_failure("EDR_ORIGINAL_CLEANUP_FAILED", cleanup_error)
                retain_failure_result(result_path, public)
                if primary_error is None:
                    raise cleanup_error
            return False
        try:
            temporary_base = args.temporary_root.resolve(strict=True) if args.temporary_root else private_dir(output / "temporary")
            if not temporary_base.is_dir():
                raise ValueError("The selected temporary volume does not exist")
            with tempfile.TemporaryDirectory(prefix="edr-browser-", dir=temporary_base) as scratch_name, contextlib.ExitStack() as lifetime:
                lifetime.push(drain_lifetime)
                scratch = Path(scratch_name)
                os.environ["TMPDIR"] = str(scratch); os.environ["SQLITE_TMPDIR"] = str(scratch); tempfile.tempdir = str(scratch)
                node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
                if not node:
                    raise RuntimeError("Select the existing Node runtime")
                os.environ.setdefault("SF30_XML_NODE", node)
                sys.path.insert(0, str(root))
                from edr_workspace import Workspace
                from edr_server import OperatorServer
                original = Workspace(workspace)
                workspaces.append(original)
                baseline = original.state()
                retained_intent = load(output / "browser-intent.json")
                pinned_inputs = {item["sha256"]: item for item in retained_intent["inputs"]["sources"]} if retained_intent else {}
                packets = list(args.source_packet)
                if not packets:
                    selected_ids = [item["sha256"] for item in retained_intent["inputs"]["sources"]] if retained_intent else [item["id"] for item in baseline["sources"]]
                    packets = [original.root / "sources" / (sid + ".edr") for sid in selected_ids]
                if not packets:
                    raise ValueError("The original native workspace must retain actual source packets")
                inputs, seen = [], set()
                for packet in packets:
                    packet = packet.absolute()
                    if not packet.is_file() or packet.is_symlink():
                        raise ValueError("An original source packet must be one retained regular file")
                    sid = digest(packet)
                    if sid in seen:
                        continue
                    seen.add(sid)
                    source = original.source(sid)
                    eligible = []
                    for build in baseline["builds"]:
                        if build["source"] != sid or sid in pinned_inputs and build["id"] != pinned_inputs[sid]["build"]:
                            continue
                        plan = original.plan(build["plan"])
                        if plan["coveragePolicy"] == args.coverage_policy:
                            eligible.append((build, plan))
                    if not eligible:
                        raise ValueError("The supplied source has no original native build using the explicitly selected coverage policy")
                    build, plan = eligible[0]
                    query = original.query(build["id"], {"limit": "1"})
                    if query["response"]["status"] != 200 or query["dataset"]["snapshot"] != build["native"]["snapshot"]:
                        raise ValueError("The original baseline native query differs from its retained build")
                    inputs.append({"path": str(packet.resolve()), "name": packet.name, "label": source["label"],
                                   "sha256": sid, "bytes": packet.stat().st_size, "inventory": source["inventory"],
                                   "expectedBuild": build, "expectedPlan": plan,
                                   "expectedFirstQuery": query["response"]["body"]})
                identity = {"coveragePolicy": args.coverage_policy,
                            "sources": [{"sha256": i["sha256"], "bytes": i["bytes"],
                                         "schemaSha256": i["inventory"]["schemaSha256"],
                                         "build": i["expectedBuild"]["id"], "plan": i["expectedBuild"]["plan"],
                                         "snapshot": i["expectedBuild"]["native"]["snapshot"]} for i in inputs]}
                input_sha = hashlib.sha256(encoded(identity)).hexdigest()
                intent_path = output / "browser-intent.json"
                intent = {"schema": "stellar-forge.edr-browser-intent.v1", "workspace": str(workspace),
                          "receiverWorkspace": str(receiver.resolve()), "inputs": identity, "inputManifestSha256": input_sha}
                prior = load(intent_path)
                if prior is not None and prior != intent:
                    raise ValueError("The original browser continuation belongs to different source, policy or native identities")
                if prior is None:
                    save(intent_path, intent)
                receiving = Workspace(receiver, create=not receiver.exists())
                workspaces.append(receiving)
                ports = load(output / "ports.json", {})
                original_server, original_thread = start_server(OperatorServer, original, ports.get("original", 0), "edr-original-http")
                servers.append((original_server, original_thread))
                receiver_server, receiver_thread = start_server(OperatorServer, receiving, ports.get("receiver", 0), "edr-customer-http")
                servers.append((receiver_server, receiver_thread))
                save(output / "ports.json", {"original": original_server.server_port, "receiver": receiver_server.server_port})
                profile = private_dir(output / "profile")
                ready = {"schema": "stellar-forge.edr-browser-ready.v1", "workspace": str(workspace),
                         "receiverWorkspace": str(receiver.resolve()), "workspaceId": original_server.workspace_id,
                         "receiverWorkspaceId": receiver_server.workspace_id, "original": original_server.startup(),
                         "receiver": receiver_server.startup(), "inputs": inputs, "inputManifestSha256": input_sha,
                         "coveragePolicy": args.coverage_policy, "sourceFiles": source_manifest(root),
                         "outputDirectory": str(output), "profileDirectory": str(profile), "temporaryDirectory": str(scratch),
                         "screenshots": args.screenshots}
                save(output / "ready.private.json", ready)
                generation.update(state="browser", inputManifestSha256=input_sha, sourceFiles=ready["sourceFiles"])
                public["status"] = "RUNNING"; save(result_path, public)
                print(json.dumps({"phase": "original-browser-start", "sources": len(inputs), "coveragePolicy": args.coverage_policy}), flush=True)
                child = subprocess.Popen([node, str(root / "delivery/browser-phase.cjs"), str(output / "ready.private.json")],
                                         env=os.environ.copy(), start_new_session=True)
                code = child.wait()
                result = load(output / "browser-result.json", {})
                if code or result.get("status") != "EDR_BROWSER_COMPLETE" or result.get("coveragePolicy") != args.coverage_policy:
                    raise RuntimeError("The original browser phase remains incomplete; inspect browser/browser-result.json")
                generation["exports"] = verify_exports(output, result)
                closing = close_owned(servers, workspaces)
                if closing:
                    raise RuntimeError("Original services did not close cleanly: " + json.dumps(closing))
                reopened = []
                with Workspace(receiver) as check:
                    for item in result["receiving"]:
                        view = check.build_view(item["build"])
                        query = check.query(item["build"], {"limit": "1"})
                        if (view["native"]["snapshot"] != item["snapshot"] or view["source"] != item["source"] or
                            view["plan"] != item["plan"] or view["rowCount"] != item["rowCount"] or
                            query["response"]["status"] != 200 or query["response"]["body"]["rows"] != item["firstQuery"]["rows"]):
                            raise ValueError("Closed and reopened customer receiving differs from its original native edition")
                        reopened.append({"build": item["build"], "source": view["source"], "plan": view["plan"],
                                         "snapshot": view["native"]["snapshot"], "rowCount": view["rowCount"],
                                         "fields": query["response"]["body"]["fields"], "rows": query["response"]["body"]["rows"]})
                # The maintained Node→Python CLI reopens the same closed receiver.
                # It borrows no HTTP service and creates no additional workspace.
                cli_results = []
                cli_commands = [("state", ["state"])]
                if result["receiving"]:
                    first = result["receiving"][0]
                    cli_commands.append(("query", ["query", "--build", first["build"], "--params", '{"limit":"1"}']))
                    cli_commands.append(("export", ["export", "--build", first["build"], "--out",
                                                    str(output / "cli-customer-project.zip")]))
                for label, arguments in cli_commands:
                    completed = subprocess.run([node, str((root / "cli.mjs").resolve(strict=True)), "--workspace", str(receiver), *arguments],
                                               env=os.environ.copy(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    receipt = {"operation": label, "exitCode": completed.returncode,
                               "stdoutBytes": len(completed.stdout), "stdoutSha256": hashlib.sha256(completed.stdout).hexdigest()}
                    save(output / ("cli-" + label + ".json"), {"receipt": receipt,
                         "result": json.loads(completed.stdout) if completed.returncode == 0 else None,
                         "error": completed.stderr.decode("utf-8", "replace")[:2000] if completed.returncode else None})
                    if completed.returncode:
                        raise RuntimeError("The original installed CLI did not complete " + label)
                    value = json.loads(completed.stdout)
                    if label == "query" and (value["response"]["status"] != 200 or
                        value["response"]["body"]["rows"] != first["firstQuery"]["rows"]):
                        raise ValueError("The original CLI reopened different native cells")
                    if label == "export":
                        expected = next(item for item in result["exports"] if item["kind"] == "project" and item["sourceIndex"] == 0)
                        if value["bytes"] != expected["bytes"] or value["sha256"] != expected["sha256"]:
                            raise ValueError("The original customer CLI did not retain the exact project bytes")
                    cli_results.append(receipt)
                completed_files = ["browser-result.json", "cli-state.json"]
                if result["receiving"]:
                    completed_files.extend(["cli-query.json", "cli-export.json", "cli-customer-project.zip"])
                generation["completionFiles"] = [{"file": name, "bytes": (output / name).stat().st_size,
                                                  "sha256": digest(output / name)} for name in completed_files]
                generation.update(state="complete", receiverReopened=reopened, cliReopened=cli_results, completedAt=utc())
                public["status"] = "EDR_OPERATOR_RECEIVING_COMPLETE"
                public["result"] = {"file": "browser-result.json", "bytes": (output / "browser-result.json").stat().st_size,
                                    "sha256": digest(output / "browser-result.json")}
                save(result_path, public)
            print(json.dumps({"status": public["status"], "result": str(result_path), "sources": len(inputs),
                              "builds": len(result["builds"]), "receiverReopened": len(reopened)}), flush=True)
        except BaseException as error:
            retain_primary(error)
            if error is not primary_error:
                generation.setdefault("cleanupErrors", []).append({
                    "operation": "temporary_lifetime", "kind": type(error).__name__,
                    "message": str(error)})
                report_failure("EDR_ORIGINAL_LIFETIME_FAILED", error,
                               primaryType=type(primary_error).__name__,
                               primaryMessage=str(primary_error)[:2000])
            generation.update(state="failed", endedAt=utc(),
                              error={"type": type(primary_error).__name__, "message": str(primary_error)[:2000]})
            public["status"] = "RETAINED_FOR_CONTINUATION"
            retain_failure_result(result_path, public)
            if error is not primary_error:
                raise primary_error.with_traceback(primary_error.__traceback__) from None
            raise
        finally:
            drain_lifetime(*sys.exc_info())

if __name__ == "__main__":
    main()

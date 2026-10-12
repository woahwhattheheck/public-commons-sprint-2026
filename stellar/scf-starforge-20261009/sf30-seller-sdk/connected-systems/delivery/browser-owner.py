"""MIT. One retained Connected Systems operator/browser/customer receiving lifetime.

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
    names = ["csapi_source.py", "csapi_workspace.py", "csapi_server.py", "cli.py", "cli.mjs",
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
                if set(members) != {"data.csv", "dataset.json", "connected-systems-lineage.json"}:
                    raise ValueError("Seller dataset export is incomplete")
                lineage = json.loads(archive.read("connected-systems-lineage.json"))
                if (lineage.get("schema") != "stellar-forge.connected-systems-lineage.v1" or
                    lineage["snapshot"] != build["snapshot"] or lineage["build"] != build["id"] or
                    lineage["rowCount"] != build["rowCount"]):
                    raise ValueError("Dataset lineage differs from its retained edition")
                if lineage["files"] != {n: build["files"][n] for n in ("data.csv", "dataset.json")}:
                    raise ValueError("Dataset lineage differs from the two exported native files")
                if hashlib.sha256(encoded(lineage["mapping"])).hexdigest() != build["plan"]:
                    raise ValueError("Dataset lineage differs from the original reviewed mapping")
            elif item["kind"] == "project":
                expected = {"manifest.json", "source.connected-systems", "plan.json", "data.csv", "dataset.json", "review.json"}
                if set(members) != expected:
                    raise ValueError("Customer project must contain all six original files")
                manifest = json.loads(archive.read("manifest.json"))
                if manifest["build"] != build["id"] or manifest["files"] != {n: v for n, v in members.items() if n != "manifest.json"}:
                    raise ValueError("Customer packet manifest differs from its original members")
                if members["source.connected-systems"]["sha256"] != build["source"] or members["plan.json"]["sha256"] != build["plan"]:
                    raise ValueError("Customer packet lost its original source or mapping")
            else:
                raise ValueError("Unknown original export kind")
            for name in ("data.csv", "dataset.json"):
                if members[name] != build["files"][name]:
                    raise ValueError("Exported native cells/configuration differ from the completed build")
        verified.append({**item, "members": members})
    return verified

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
    if not (root / "csapi_workspace.py").is_file():
        raise ValueError("Select the complete maintained Connected Systems source directory")
    operation = private_dir(args.operation_root)
    output = private_dir(operation / "browser")
    workspace = args.workspace.resolve(strict=True)
    receiver = operation / "browser-receiving-workspace"
    if workspace == receiver.resolve():
        raise ValueError("Independent customer receiving requires its separate saved workspace")
    lock = lock_owner(output / "owner.lock")
    child = None
    servers, workspaces = [], []
    result_path = output / "owner-result.json"
    public = load(result_path, {"schema": "stellar-forge.connected-systems-browser-owner.v1", "generations": []})
    generation = {"startedAt": utc(), "pid": os.getpid(), "state": "starting", "coveragePolicy": args.coverage_policy}
    public["generations"].append(generation)
    try:
        temporary_base = args.temporary_root.resolve(strict=True) if args.temporary_root else private_dir(output / "temporary")
        if not temporary_base.is_dir():
            raise ValueError("The selected temporary volume does not exist")
        def drain_lifetime():
            # Drain original requests/engines before their temporary volume closes.
            stop_child(child)
            closing = close_owned(servers, workspaces)
            if closing:
                generation.setdefault("cleanupErrors", []).extend(closing)
                public["status"] = "RETAINED_FOR_CONTINUATION"
                save(result_path, public)
        with tempfile.TemporaryDirectory(prefix="connected-systems-browser-", dir=temporary_base) as scratch_name, contextlib.ExitStack() as lifetime:
            lifetime.callback(drain_lifetime)
            scratch = Path(scratch_name)
            os.environ["TMPDIR"] = str(scratch); os.environ["SQLITE_TMPDIR"] = str(scratch); tempfile.tempdir = str(scratch)
            node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
            if not node:
                raise RuntimeError("Select the existing Node runtime")
            os.environ.setdefault("SF30_XML_NODE", node)
            sys.path.insert(0, str(root))
            from csapi_workspace import Workspace
            from csapi_server import OperatorServer
            original = Workspace(workspace)
            workspaces.append(original)
            baseline = original.state()
            retained_intent = load(output / "browser-intent.json")
            pinned_inputs = {item["sha256"]: item for item in retained_intent["inputs"]["sources"]} if retained_intent else {}
            packets = list(args.source_packet)
            if not packets:
                selected_ids = [item["sha256"] for item in retained_intent["inputs"]["sources"]] if retained_intent else [item["id"] for item in baseline["sources"]]
                packets = [original.root / "sources" / (sid + ".connected-systems") for sid in selected_ids]
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
            intent = {"schema": "stellar-forge.connected-systems-browser-intent.v1", "workspace": str(workspace),
                      "receiverWorkspace": str(receiver.resolve()), "inputs": identity, "inputManifestSha256": input_sha}
            prior = load(intent_path)
            if prior is not None and prior != intent:
                raise ValueError("The original browser continuation belongs to different source, policy or native identities")
            if prior is None:
                save(intent_path, intent)
            receiving = Workspace(receiver, create=not receiver.exists())
            workspaces.append(receiving)
            ports = load(output / "ports.json", {})
            original_server, original_thread = start_server(OperatorServer, original, ports.get("original", 0), "csapi-original-http")
            servers.append((original_server, original_thread))
            receiver_server, receiver_thread = start_server(OperatorServer, receiving, ports.get("receiver", 0), "csapi-customer-http")
            servers.append((receiver_server, receiver_thread))
            save(output / "ports.json", {"original": original_server.server_port, "receiver": receiver_server.server_port})
            profile = private_dir(output / "profile")
            ready = {"schema": "stellar-forge.connected-systems-browser-ready.v1", "workspace": str(workspace),
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
            if code or result.get("status") != "CONNECTED_SYSTEMS_BROWSER_COMPLETE" or result.get("coveragePolicy") != args.coverage_policy:
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
                completed = subprocess.run([node, str(root / "cli.mjs"), "--workspace", str(receiver), *arguments],
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
            generation.update(state="complete", receiverReopened=reopened, cliReopened=cli_results, completedAt=utc())
            public["status"] = "CONNECTED_SYSTEMS_OPERATOR_RECEIVING_COMPLETE"
            public["result"] = {"file": "browser-result.json", "bytes": (output / "browser-result.json").stat().st_size,
                                "sha256": digest(output / "browser-result.json")}
            save(result_path, public)
            print(json.dumps({"status": public["status"], "result": str(result_path), "sources": len(inputs),
                              "builds": len(result["builds"]), "receiverReopened": len(reopened)}), flush=True)
    except BaseException as error:
        generation.update(state="failed", endedAt=utc(),
                          error={"type": type(error).__name__, "message": str(error)[:2000]})
        public["status"] = "RETAINED_FOR_CONTINUATION"
        save(result_path, public)
        raise
    finally:
        stop_child(child)
        closing = close_owned(servers, workspaces)
        if closing:
            generation["cleanupErrors"] = closing
            save(result_path, public)
        lock.close()

if __name__ == "__main__":
    main()

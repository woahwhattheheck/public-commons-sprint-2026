"""Materialize the complete selected Delivery Risk application and receiving course.

This preparer reads an explicitly selected original checkout and full source
packets. It does not fetch credentials, source, dependencies or browser runtimes.
An optional run keeps the original execution child through its actual close.
"""
from __future__ import annotations
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import tempfile
import sys

SCHEMA = "stellar-forge.sf47-risk-preparation.v1"
WORKSPACE = "stellar/scf_2026/sf47_budget_model/workspace"
EXPECTED_REPOSITORY = "woahwhattheheck/tjlabs-stellar-merchant-workspace"


def need(ok, message):
    if not ok:
        raise RuntimeError(message)


def source_read(path):
    path = Path(path)
    need(path.is_absolute() and path.resolve(strict=True) == path, "Select an actual absolute nonsymlink source.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= 32 * 1024 * 1024, "Use a bounded original source file.")
        with os.fdopen(fd, "rb") as stream:
            fd = None
            raw = stream.read()
            after = os.fstat(stream.fileno())
        current = path.lstat()
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_mode)
        need(identity(before) == identity(after) == identity(current) and len(raw) == after.st_size,
             "A selected original source changed while reading.")
        return raw, stat.S_IMODE(after.st_mode)
    finally:
        if fd is not None:
            owned, fd = fd, None
            os.close(owned)


def selected(row):
    raw, mode = source_read(row["path"])
    need(len(raw) == row["bytes"] and hashlib.sha256(raw).hexdigest() == row["sha256"],
         "A complete original source descriptor differs.")
    return raw, mode


def git(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


def relative(name):
    value = Path(name)
    need(isinstance(name, str) and name and not value.is_absolute() and ".." not in value.parts
         and value.as_posix() == name and not any(ord(c) < 32 for c in name) and "\\" not in name,
         "Use canonical repository-relative source names.")
    return value


def helper(config):
    raw, _mode = selected(config["executionSource"])
    need(Path(config["executionSource"]["path"]).name == "operations_risks_execution.py",
         "Select the complete original execution owner.")
    spec = importlib.util.spec_from_file_location("risk_selected_execution", config["executionSource"]["path"])
    module = importlib.util.module_from_spec(spec)
    # Execute exactly the source bytes already verified, avoiding a second loader read.
    exec(compile(raw, config["executionSource"]["path"], "exec"), module.__dict__)
    need(module.SCHEMA == "stellar-forge.sf47-risk-execution.v1", "Use the original execution helper.")
    return module


def prepare(config):
    need(config.get("schema") == SCHEMA, "Use the complete original preparation input.")
    owner = helper(config)
    prepared = owner.private(Path(config["preparationDirectory"]))
    source = Path(config["originalRepositoryRoot"]).resolve(strict=True)
    target = owner.private(Path(config["repositoryRoot"]))
    output = Path(config["outputDirectory"])
    need(output.is_absolute(), "Select the original private output directory.")
    for left, right in ((source, target), (source, prepared), (target, prepared),
                        (source, output), (target, output), (prepared, output)):
        need(not left.is_relative_to(right) and not right.is_relative_to(left),
             "Keep the original checkout, source copy, preparation and case roots separate.")
    guard = owner.Guard(prepared / "preparation.guard")
    failure = None
    result = None
    try:
        owner.publish(prepared / "PREPARATION_SELECTION.json", owner.encoded(config))
        selection_raw, _ = selected(config["sourceSelection"])
        selection = json.loads(selection_raw)
        need(selection["schema"] == "stellar-forge.sf47-risk-runtime-source-selection.v1"
             and selection["repository"] == EXPECTED_REPOSITORY and selection["pathBase"] == "repository"
             and selection["workspacePath"] == WORKSPACE and len(selection["revision"]) == 40,
             "Use the retained complete original runtime selection.")
        need(selection["operationId"] == config["operationId"], "Preserve this original risk operation.")
        rows = {}
        bodies = {}
        def include(row, raw, provenance):
            name = relative(row["path"]).as_posix()
            need(name not in rows, "The selected complete source repeats a path: " + name)
            need(len(raw) == row["bytes"], "A selected full source size differs: " + name)
            blob = row.get("git_blob", row.get("git_blob_sha"))
            digest = owner.sha(raw)
            need(blob is not None or row.get("sha256") is not None,
                 "Select an exact complete Git or SHA256 identity: " + name)
            if blob is not None:
                need(isinstance(blob, str) and len(blob) == 40 and git(raw) == blob,
                     "A selected full source Git identity differs: " + name)
            else:
                blob = git(raw)
            if row.get("sha256") is not None:
                need(digest == row["sha256"], "A selected source SHA differs: " + name)
            mode = row.get("mode", 0o644)
            mode = int(mode, 8) & 0o777 if isinstance(mode, str) else mode
            need(mode in (0o600, 0o644, 0o700, 0o755), "Select a regular original source mode.")
            rows[name] = {"path": name, "bytes": len(raw), "sha256": digest,
                          "git_blob": blob, "mode": mode, "provenance": provenance}
            bodies[name] = raw
        for row in selection["files"]:
            raw, _ = source_read(source / relative(row["path"]))
            include(row, raw, {"kind": "original-runtime", "revision": selection["revision"]})
        for row in config["originalSupport"]:
            raw, _ = source_read(source / relative(row["path"]))
            include(row, raw, {"kind": "original-support", "revision": selection["revision"]})
        packet_receipts = []
        for packet_reference in config["receivingPackets"]:
            packet_raw, _ = selected(packet_reference)
            packet = json.loads(packet_raw)
            need(packet.get("repository") == EXPECTED_REPOSITORY, "Use the original repository's complete receiving packet.")
            packet_receipts.append(packet_reference)
            for row in packet["files"]:
                need(isinstance(row.get("content"), str), "Select every complete receiving source body.")
                include(row, row["content"].encode("utf-8"), {"kind": "receiving-source", "packetSha256": packet_reference["sha256"]})
        expected_execution = WORKSPACE + "/operations_risks_execution.py"
        need(expected_execution in rows and rows[expected_execution]["sha256"] == config["executionSource"]["sha256"]
             and rows[expected_execution]["bytes"] == config["executionSource"]["bytes"],
             "Use the same complete execution owner selected before preparation.")
        self_raw, self_mode = source_read(Path(__file__).resolve(strict=True))
        own = rows.get(WORKSPACE + "/operations_risks_prepare.py")
        need(own and own["bytes"] == len(self_raw) and own["sha256"] == owner.sha(self_raw) and own["mode"] == self_mode,
             "Include the exact executed preparer in the complete receiving source.")
        need(WORKSPACE + "/operations_walkthrough.py" in rows
             and WORKSPACE + "/operations_risks_walkthrough.py" in rows
             and WORKSPACE + "/operations_risks_browser.mjs" in rows,
             "Keep the complete original helper, native course and browser companion.")
        for selector in selection["selectors"]:
            actual = rows.get(selector["path"])
            need(actual and all(actual[key] == selector[key] for key in ("bytes", "sha256", "git_blob")),
                 "The actual captured original selector changed.")
        module = ast.parse(bodies[WORKSPACE + "/managed_launch.py"])
        declarations = [node.value for node in module.body if isinstance(node, ast.Assign)
                        and any(isinstance(name, ast.Name) and name.id == "BOOT_FILES" for name in node.targets)]
        if declarations:
            need(len(declarations) == 1, "Retain the original literal BOOT_FILES.")
            boot = ast.literal_eval(declarations[0])
        else:
            from managed_source import manifest_selector
            boot, _manifest_raw = manifest_selector(bodies[WORKSPACE + "/managed_launch.py"],
                lambda: bodies[WORKSPACE + "/managed-source.json"])
        need(boot == tuple(row["relative"] for row in selection["files"])
             or boot == [row["relative"] for row in selection["files"]],
             "The whole current managed selection changed.")
        scenario_name = relative(config["scenarioPath"]).as_posix()
        need(scenario_name in rows, "Select the complete original scenario as an explicit support member.")
        # All full originals have passed before any selected application file is published.
        for name in sorted(rows):
            path = target / name
            owner.private(path.parent)
            if path.exists():
                raw, mode = source_read(path)
                need(raw == bodies[name] and mode == rows[name]["mode"], "A retained source postimage differs: " + name)
                owner.sync(path.parent)
            else:
                fd = temporary = None
                cleanup_error = None
                try:
                    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
                    owned, fd = fd, None
                    with os.fdopen(owned, "wb") as stream:
                        os.fchmod(stream.fileno(), rows[name]["mode"])
                        stream.write(bodies[name])
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.link(temporary, path)
                    os.unlink(temporary)
                    temporary = None
                    owner.sync(path.parent)
                except BaseException as error:
                    cleanup_error = error
                finally:
                    if fd is not None:
                        owned, fd = fd, None
                        try:
                            os.close(owned)
                        except BaseException as error:
                            cleanup_error = cleanup_error or error
                    if temporary is not None:
                        try:
                            os.unlink(temporary)
                        except FileNotFoundError:
                            pass
                        except BaseException as error:
                            cleanup_error = cleanup_error or error
                if cleanup_error:
                    raise cleanup_error
            raw, mode = source_read(path)
            need(owner.sha(raw) == rows[name]["sha256"] and len(raw) == rows[name]["bytes"]
                 and mode == rows[name]["mode"], "A published complete source differs.")
        directories = {target}
        for name in rows:
            directory = (target / name).parent
            while directory.is_relative_to(target):
                directories.add(directory)
                if directory == target:
                    break
                directory = directory.parent
        for directory in sorted(directories, key=lambda value: len(value.parts), reverse=True):
            owner.sync(directory)
        owner.sync(target.parent)
        manifest = {"schema": "stellar-forge.sf47-risk-complete-source.v1",
                    "repository": selection["repository"], "revision": selection["revision"],
                    "pathBase": "repository", "workspacePath": WORKSPACE,
                    "sourceSelection": config["sourceSelection"], "receivingPackets": packet_receipts,
                    "files": [rows[name] for name in sorted(rows)]}
        manifest_path = prepared / "RISK_COMPLETE_SOURCE.json"
        owner.publish(manifest_path, owner.encoded(manifest))
        execution = {"schema": owner.SCHEMA, "operationId": config["operationId"],
                     "repositoryRoot": str(target), "outputDirectory": str(output),
                     "sourceManifest": owner.descriptor(manifest_path),
                     "scenario": owner.descriptor(target / scenario_name),
                     "python": config["python"], "node": config["node"],
                     "browserScript": "operations_risks_browser.mjs", "browser": config["browser"]}
        if config.get("library") is not None:
            execution["library"] = config["library"]
        if config.get("planId") is not None:
            execution["planId"] = config["planId"]
        # The execution child verifies its own source path. Preparation verifies
        # actual selected runtime bytes without substituting that child's identity.
        for key in ("python", "node"):
            need(Path(config[key]["path"]).resolve(strict=True) == Path(config[key]["path"]),
                 "Select the canonical executable file, not a symlink alias.")
            _identity, runtime_info = owner.checked_fingerprint(config[key])
            need(stat.S_IMODE(runtime_info.st_mode) & 0o111, "Select executable native runtimes.")
        need(Path(sys.executable).resolve(strict=True) == Path(config["python"]["path"]).resolve(strict=True),
             "Run preparation with the exact selected Python.")
        for name, digest in (("playwrightModule", "playwrightSha256"), ("executablePath", "executableSha256")):
            identity, info = owner.fingerprint(config["browser"][name])
            need(identity["sha256"] == config["browser"][digest], "The selected browser runtime changed.")
            if name == "executablePath":
                need(stat.S_IMODE(info.st_mode) & 0o111, "Select executable Chromium.")
        if config.get("library") is not None:
            library = config["library"]
            need({Path(row["path"]).name for row in library["files"]} ==
                 {"library_upload.py", "library_hosted_apps.py", "library_file_transfer.py"},
                 "Select all three unchanged original upload helpers.")
            for row in library["files"]:
                need(Path(row["path"]).resolve(strict=True).parent == Path(library["helperDirectory"]).resolve(strict=True),
                     "Retain the complete helper cohort in its selected directory.")
                owner.checked(row)
        input_path = prepared / "RISK_EXECUTION_INPUT.json"
        owner.publish(input_path, owner.encoded(execution))
        result = {"schema": SCHEMA + ".prepared", "status": "PREPARED",
                  "operationId": config["operationId"], "sourceManifest": owner.descriptor(manifest_path),
                  "input": owner.descriptor(input_path), "files": len(rows),
                  "sourceBytes": sum(row["bytes"] for row in rows.values())}
        owner.publish(prepared / "PREPARED.json", owner.encoded(result))
    except BaseException as error:
        failure = error
    finally:
        try:
            guard.close()
        except BaseException as error:
            failure = failure or error
    if failure:
        raise failure
    return result


def run(config, result):
    child = None
    first = None
    selected_signal = None
    previous = {}
    def stop(signum, _frame):
        nonlocal selected_signal
        if selected_signal is None:
            selected_signal = signum
            if child is not None and child.poll() is None:
                try:
                    child.send_signal(signum)
                except ProcessLookupError:
                    pass
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous[sig] = signal.signal(sig, stop)
        child = subprocess.Popen([config["python"]["path"], "-B",
            str(Path(config["repositoryRoot"]) / WORKSPACE / "operations_risks_execution.py"),
            "--input", result["input"]["path"]], stdin=subprocess.DEVNULL)
        if selected_signal is not None:
            child.send_signal(selected_signal)
        code = child.wait()
        need(code == 0, "The original risk execution did not complete; retain its exact case and receipts.")
        need(selected_signal is None, "The original receiving invocation was stopped.")
    except BaseException as error:
        first = error
    finally:
        if child is not None:
            while child.poll() is None:
                try:
                    child.send_signal(selected_signal or signal.SIGTERM)
                    child.wait()
                except ProcessLookupError:
                    child.wait()
                except BaseException as error:
                    first = first or error
        for sig, previous_handler in previous.items():
            signal.signal(sig, previous_handler)
    if first:
        raise first


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()
    config = json.loads(source_read(Path(args.input).resolve(strict=True))[0])
    result = prepare(config)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    if args.run:
        run(config, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

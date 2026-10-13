#!/usr/bin/env python3
"""Continue one existing preservation case through complete transfer inspection and receiving."""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import zipfile

sys.dont_write_bytecode = True
SCHEMA = "stellar-forge.transfer-inspection-receiving.v1"

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("application", "workspace", "previous", "current", "operation"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args(argv)
    application, workspace, previous, current, operation = [
        Path(getattr(args, name)).expanduser().absolute()
        for name in ("application", "workspace", "previous", "current", "operation")]
    module_root = application / "research/preservation"
    sys.path.insert(0, str(module_root))
    import preservation as p
    import collection_accession as c
    import transfer_inspection as t
    import workbench as w
    for module in (p, c, t, w):
        if Path(module.__file__).resolve().parent != module_root.resolve():
            raise ValueError("The selected complete application was not imported.")
    if operation.is_symlink() or not operation.is_dir():
        raise ValueError("Select the original existing private receiving operation directory.")
    control = workspace.parent / (workspace.name + ".operator")
    if not workspace.is_dir() and not (control / "accessions").is_dir():
        raise ValueError("Select the existing original research or collection Workbench.")
    for root in (workspace, control):
        if operation.resolve().is_relative_to(root.resolve()):
            raise ValueError("Keep the original operating records outside workspace and operator storage.")

    def need(value, message):
        if not value: raise ValueError(message)
    def identity(path):
        return w.file_digest(Path(path), w.MAX_SNAPSHOT)
    def publish(path, value, replace=False):
        data = p.canonical(value)
        if path.exists() and not replace:
            need(path.read_bytes() == data, "Retained original output differs: " + str(path))
        else:
            (p.replace_bytes if replace else p.write_new)(path, data)

    fd = os.open(operation / "transfer-inspection.lock",
                 os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        need(stat.S_ISREG(os.fstat(fd).st_mode), "The original case guard is not a regular file.")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.set_inheritable(fd, True)
        folder = operation / "transfer-inspection"
        w.directory(folder); p.fsync_dir(folder.parent)
        source_names = list(w.APPLICATION) + list(w.COLLECTION_APPLICATION) + list(w.TRANSFER_APPLICATION)
        for group in (w.PRESERVICA_APPLICATION, w.LIBNOVA_APPLICATION, w.ARCHIVEMATICA_APPLICATION):
            present = [(application / name).is_file() for name in group]
            if any(present):
                need(all(present), "The original selected provider source group is incomplete.")
                source_names.extend(group)
        source_files = {name: identity(application / name) for name in sorted(set(source_names))}
        selected = {"schema": SCHEMA + ".selection", "application": str(application),
                    "workspace": str(workspace), "operation": str(operation),
                    "packages": [{"path": str(path), **identity(path)} for path in (previous, current)],
                    "sourceFiles": source_files}
        publish(folder / "selection.json", selected)
        for name, expected in source_files.items():
            w.copy_file(application / name, folder / "producing-source" / name, expected)
        journal_path = folder / "progress.json"
        journal = p.parse_json(journal_path.read_bytes()) if journal_path.exists() else {
            "schema": SCHEMA + ".progress", "selectionSha256": p.digest(p.canonical(selected)), "steps": {}}
        need(journal["selectionSha256"] == p.digest(p.canonical(selected)), "Original selection changed.")
        def checkpoint(key, value):
            if key in journal["steps"]:
                need(journal["steps"][key] == value, "The original completed phase differs: " + key)
            else:
                journal["steps"][key] = value
            publish(journal_path, journal, replace=True)
            print(json.dumps({"phase": key, "retained": True}), flush=True)
            return value

        app = w.Workbench(workspace)
        try:
            before = {"research": p.show(workspace) if workspace.exists() else None,
                      "accessions": c.bindings(app.accessions, True)}
            publish(folder / "original-source-and-reviews.json", before)
            def choose(path):
                for artifact in app.artifacts:
                    if (app.control / artifact["path"]).resolve() == path.resolve():
                        need(identity(path) == {k: artifact[k] for k in ("bytes", "sha256")},
                             "The selected original package changed.")
                        return {"kind": "artifact", "id": artifact["id"]}
                return {"kind": "path", "path": str(path)}
            chosen = [choose(previous), choose(current)]
            publish(folder / "selected-package-inputs.json", chosen)
            def run(mode, values):
                request = p.digest(p.canonical({"selection": journal["selectionSha256"], "mode": mode, "selections": values}))
                matching = [job for job in app.jobs if job.get("arguments", {}).get("receivingRequestId") == request]
                completed = [job for job in matching if job["state"] == "COMPLETED"]
                need(len(completed) <= 1, "Multiple completed original jobs require explicit reconciliation.")
                if completed:
                    job = completed[0]
                else:
                    need(all(job["state"] in {"FAILED", "INTERRUPTED"} for job in matching),
                         "An original report operation remains active.")
                    arguments = {"mode": mode, "selections": values, "receivingRequestId": request,
                                 "resumeOf": matching[-1]["id"] if matching else None}
                    queued = app.queue("transfer-" + mode, arguments,
                                       lambda _: app.transfer_report(mode, values))
                    app.worker.join()
                    job = next(row for row in app.jobs if row["id"] == queued["job"]["id"])
                    need(job["state"] == "COMPLETED", "Original report failed: " + json.dumps(job))
                for artifact in job["result"]["artifacts"].values():
                    path, retained = app.artifact_path(artifact["id"])
                    need(retained == artifact, "Original completed report artifact changed.")
                checkpoint(mode + "-job", {"id": job["id"], "result": job["result"]})
                return job["result"]

            inspected = run("inspect", [chosen[1]])
            compared = run("compare", chosen)
            current_identity = inspected["packages"][0]
            expected = t.inspect(app.control / current_identity["retainedPath"], current_identity)
            inspection_path, _ = app.artifact_path(inspected["artifacts"]["json"]["id"])
            need(p.parse_json(inspection_path.read_bytes()) == expected, "Original complete inspection differs.")
            identities = compared["packages"]
            expected_comparison = t.compare(*(app.control / item["retainedPath"] for item in identities), *identities)
            comparison_path, _ = app.artifact_path(compared["artifacts"]["json"]["id"])
            need(p.parse_json(comparison_path.read_bytes()) == expected_comparison, "Original complete comparison differs.")
            for result, report in ((inspected, expected), (compared, expected_comparison)):
                for extension, body in (("json", t.encoded(report)), ("html", t.report_html(report)), ("csv", t.report_csv(report))):
                    path, _ = app.artifact_path(result["artifacts"][extension]["id"])
                    need(path.read_bytes() == body, "Complete " + extension + " export differs.")
            after = {"research": p.show(workspace) if workspace.exists() else None,
                     "accessions": c.bindings(app.accessions, True)}
            need(before == after, "Inspection changed original source or saved review history.")
            checkpoint("original-engine-and-source", {"inspection": inspected["reportId"],
                "comparison": compared["reportId"], "sourceAndReviewsSha256": p.digest(p.canonical(before))})
            complete = app.deliveries / ("Transfer_Desk_" + journal["selectionSha256"] + ".zip")
            if not complete.exists():
                w.export_workspace(app, complete)
            with zipfile.ZipFile(complete) as archive:
                manifest = w.snapshot_manifest(archive)
                for result in (inspected, compared):
                    for artifact in result["artifacts"].values():
                        need(manifest["files"].get("operator/" + artifact["path"]) ==
                             {key: artifact[key] for key in ("bytes", "sha256")},
                             "The retained complete export belongs to another report selection.")
                    for item in result["packages"]:
                        need(manifest["files"].get("operator/" + item["retainedPath"]) ==
                             {key: item[key] for key in ("bytes", "sha256")},
                             "The complete export is missing an original package.")
            app.artifact(complete, "complete-workspace", manifest["selection"])
            checkpoint("complete-export", {"file": str(complete), **identity(complete)})
        finally:
            app.close()

        received = folder / "received"
        receipt = w.receive_workspace(complete, received)
        checkpoint("cold-receive", {"directory": str(received), "archive": receipt["archive"]})
        complete_path = folder / "COMPLETE.json"
        # The receiver itself checks immutable application/report/original members on every reuse.
        # Exact first-copy inventory is retained before any later local host bookkeeping.
        verified = 0
        for name, expected_identity in manifest["files"].items():
            parts = name.split("/")
            target = received.joinpath(*(["workspace.operator"] + parts[1:] if parts[0] == "operator" else parts))
            bookkeeping = name in {"operator/jobs.json", "operator/artifacts.json"} and complete_path.exists()
            need(identity(target) == expected_identity or bookkeeping, "Received full member differs: " + name)
            verified += 1
        copied_module = received / "application/research/preservation"
        received_package = received / "workspace.operator" / current_identity["retainedPath"]
        command = [sys.executable, "-B", str(copied_module / "transfer_inspection.py"),
                   "inspect", "--source", str(received_package)]
        native = subprocess.run(command, check=True, capture_output=True, text=True, pass_fds=(fd,))
        observed = p.parse_json(native.stdout.encode())
        need(observed["rows"] == expected["rows"] and observed["verification"] == expected["verification"],
             "The independently received native application returned another original package.")
        checkpoint("native-cold-open", {"command": command, "verifiedMembers": verified,
            "rows": len(observed["rows"]), "verification": observed["verification"]})
        need(all(identity(application / name) == expected_identity for name, expected_identity in source_files.items()),
             "The complete producing source changed.")
        need([{"path": str(path), **identity(path)} for path in (previous, current)] == selected["packages"],
             "An original selected package changed.")
        final = {"schema": SCHEMA + ".result", "phase": "COMPLETE",
                 "selectionSha256": journal["selectionSha256"], "sourceFiles": source_files,
                 "originalPackages": selected["packages"], "workspace": str(workspace),
                 "inspection": inspected, "comparison": compared, "steps": journal["steps"],
                 "received": str(received),
                 "browser": "Actual original-case desktop/narrow controls, full downloads and rendered inspection remain separately recorded."}
        publish(complete_path, final)
        print(json.dumps(final, ensure_ascii=False, allow_nan=False))
        return 0
    finally:
        # Closing our descriptor leaves the inherited lock held by any surviving original child.
        os.close(fd)

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"phase": "FAILED", "error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        raise SystemExit(1)

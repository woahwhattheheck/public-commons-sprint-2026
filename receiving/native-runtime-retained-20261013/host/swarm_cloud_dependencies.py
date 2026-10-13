#!/usr/bin/env python3
"""Prepare an existing cloud worker's Node project from retained dependencies.

The original lockfile materializer owns dependency interpretation and extraction;
the original native job owns command identity, process lifetime and reconnects.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import node_lockfile_cache as cache
import node_dependency_borrow as borrow

SCHEMA = "commons.worker_node_dependencies/v1"
REPORT = "dependency-recovery.json"


def recovery_options(parser):
    parser.add_argument("--borrow-node-modules", help="reuse this installed dependency tree through the original native runtime registry")
    parser.add_argument("--materialize-borrowed", action="store_true",
                        help="preserve the entire borrowed package layout using immutable equal-file hardlinks and private copies")
    parser.add_argument("--reuse-node-modules", action="append", default=[],
                        help="additional immutable installed tree for exact byte/mode reuse; repeat")
    parser.add_argument("--immutable-source-reference",
                        help="existing ownership reference for the immutable installed sources")
    parser.add_argument("--lockfile", help="original lockfile in the selected project; defaults to npm-shrinkwrap.json, then package-lock.json")
    parser.add_argument("--cache-root", action="append", default=[], help="additional retained npm cache or its _cacache directory; repeat to combine")
    parser.add_argument("--omit", action="append", choices=("dev", "optional"), default=[])
    for field in ("os", "cpu", "libc"):
        parser.add_argument("--target-" + field)
    parser.add_argument("--max-archive-bytes", type=cache.package_cache.positive_int, default=32 * 1024 * 1024)
    parser.add_argument("--max-tar-bytes", type=cache.package_cache.positive_int, default=128 * 1024 * 1024)
    parser.add_argument("--max-members", type=cache.package_cache.positive_int, default=20000)


def selected_cache(path):
    root = Path(path).expanduser().resolve()
    # Both explicit spellings select the same original npm content store.
    return root / "_cacache" if (root / "_cacache").is_dir() else root


def source_paths(args):
    project = Path(args.project).expanduser().resolve(strict=True)
    if not project.is_dir():
        raise ValueError("Select an existing Node project directory.")
    if args.lockfile:
        supplied = Path(args.lockfile).expanduser()
        lockfile = (supplied if supplied.is_absolute() else project / supplied).resolve(strict=True)
    else:
        lockfile = project / ("npm-shrinkwrap.json" if (project / "npm-shrinkwrap.json").exists() else "package-lock.json")
        lockfile = lockfile.resolve(strict=True)
    if lockfile.parent != project:
        raise ValueError("The selected lockfile must belong to --project; select a nested package as its own project.")
    return project, lockfile


def recovery_args(args, lockfile, roots, *, scratch=None, destination=None):
    return SimpleNamespace(lockfile=str(lockfile), cache_root=[str(root) for root in roots],
        omit=sorted(set(args.omit)), target_os=args.target_os, target_cpu=args.target_cpu,
        target_libc=args.target_libc, scratch_root=scratch, destination=destination,
        max_archive_bytes=args.max_archive_bytes, max_tar_bytes=args.max_tar_bytes,
        max_members=args.max_members)


def plan(args):
    from swarm_cloud_worker import profile_values, placement
    project, lockfile = source_paths(args)
    if (getattr(args, "materialize_borrowed", False) or getattr(args, "reuse_node_modules", []) or getattr(args, "immutable_source_reference", None)) and not args.borrow_node_modules:
        raise ValueError("Installed materialization options require --borrow-node-modules.")
    values, _ = profile_values(args, create=False)
    locations = placement(values, args.records_root)
    worker_cache = Path(values["npm_config_cache"]) / "_cacache"
    roots = ([worker_cache] if worker_cache.is_dir() else [])
    roots += [selected_cache(path) for path in args.cache_root]
    roots = list(dict.fromkeys(roots))
    recovery = (borrow.build_plan(args, lockfile, project) if args.borrow_node_modules
                else cache.build_plan(recovery_args(args, lockfile, roots)))
    return {"schema": SCHEMA, "peer": args.peer, "project": str(project),
            "placement": locations, "worker_cache": {"path": str(worker_cache), "present": worker_cache.is_dir()},
            "recovery": recovery}, values


def print_plan(report, out=None):
    if out:
        cache.write_json(Path(out).expanduser(), report)
        print(json.dumps({"schema": SCHEMA, "report": str(out), "project": report["project"],
            "outcome": report["recovery"]["outcome"], "counts": report["recovery"]["counts"]}))
    else:
        print(json.dumps(report, indent=2, ensure_ascii=True))


def recovery_code(plan):
    return 0 if plan["outcome"] in ("planned", "materialized", "borrowed") else 1 if plan["outcome"] == "missing" else 2


def prepare(args, command):
    from swarm_cloud_job import launch_selected, run_path
    report, values = plan(args)
    recovery = report["recovery"]
    if recovery_code(recovery):
        print_plan(report)
        return recovery_code(recovery)
    project = Path(report["project"])
    locations = report["placement"]
    record = run_path(args.operation_id, locations["records_root"])
    native = [sys.executable, "-B", str(Path(__file__).resolve()), "_prepare",
              "--project", str(project), "--lockfile", recovery["lockfile"]["path"],
              "--expected-lockfile-sha256", recovery["lockfile"]["sha256"],
              "--report", str(record / REPORT), "--scratch-root", values["TMPDIR"]]
    if args.borrow_node_modules:
        native += ["--borrow-node-modules", recovery["source"]["selected_path"],
                   "--expected-borrow-sha256", recovery["inventory_sha256"]]
        if getattr(args, "materialize_borrowed", False):
            native += ["--materialize-borrowed", "--immutable-source-reference",
                       recovery["materialization"]["immutable_reference"]]
            for root in getattr(args, "reuse_node_modules", []):
                native += ["--reuse-node-modules", str(Path(root).expanduser().resolve())]
    for root in recovery["cache_roots"]:
        native += ["--cache-root", root]
    for field, value in recovery["target"].items():
        if value:
            native += ["--target-" + field, value]
    for omitted in recovery["omit"]:
        native += ["--omit", omitted]
    for name in ("max_archive_bytes", "max_tar_bytes", "max_members"):
        native += ["--" + name.replace("_", "-"), str(getattr(args, name))]
    if command:
        native += ["--", *command]
    paths = list(args.runtime_path)
    if args.borrow_node_modules:
        paths += [recovery["source"]["selected_path"], recovery["source"]["path"]]
        paths += [row["path"] for row in recovery.get("materialization", {}).get("sources", [])]
    selected = SimpleNamespace(**{**vars(args),
        "action": "start" if args.detach else "run", "project": str(project),
        "worker_root": locations["worker_root"], "temp_root": locations["temporary_root"],
        "records_root": locations["records_root"], "runtime_path": list(dict.fromkeys(paths)),
        "command": native})
    # Reuse every original capacity, artifact and runtime option with the same
    # native launch/follow path; no separate supervisor or argument vocabulary.
    return launch_selected(selected)


def run_preparation(args, command):
    from swarm_cloud_job import save_json
    project, lockfile = source_paths(args)
    recovery = {"schema": cache.SCHEMA, "outcome": "error", "errors": []}
    try:
        if hashlib.sha256(lockfile.read_bytes()).hexdigest() != args.expected_lockfile_sha256:
            raise ValueError("Original lockfile changed after this operation was selected.")
        arguments = recovery_args(args, lockfile, args.cache_root,
            scratch=args.scratch_root, destination=str(project / "node_modules"))
        if args.borrow_node_modules:
            if not args.expected_borrow_sha256:
                raise ValueError("Use the original node-deps prepare to select the installed dependency identity.")
            recovery = borrow.build_plan(args, lockfile, project, capture_materialization=True)
            borrow.attach(recovery, args.expected_borrow_sha256)
            if recovery["outcome"] in ("borrowed", "materialized"):
                from runtime_consumers import refresh
                refresh(Path(args.report).resolve().parent)
        else:
            recovery = cache.build_plan(arguments)
            cache.restore(arguments, recovery)
    except (OSError, ValueError, RuntimeError, cache.package_cache.SourceError) as exc:
        recovery["outcome"] = "error"
        recovery["errors"].append(cache.issue(getattr(exc, "code", "RECOVERY"), str(exc)))
    if "counts" in recovery:
        recovery["counts"]["errors"] = len(recovery["errors"])
    save_json(Path(args.report), recovery)
    print(json.dumps({"schema": SCHEMA, "report": args.report, **{name: recovery.get(name) for name in
        ("outcome", "counts", "lockfile", "destination", "stage", "install_scripts", "errors",
         "method", "source", "inventory_sha256", "attachment", "materialization")}}), flush=True)
    code = recovery_code(recovery)
    if code or not command:
        return code
    from runtime_consumers import refresh
    refresh(Path(args.report).resolve().parent)
    environment = dict(os.environ)
    environment["PATH"] = str(project / "node_modules/.bin") + os.pathsep + environment.get("PATH", "")
    os.chdir(project)
    os.execvpe(command[0], command, environment)



def finalize(args):
    """Finish the complete stage retained by this original terminal native job."""
    import fcntl
    import stat
    import tempfile
    import node_dependency_materialize as storage
    from swarm_cloud_job import save_json
    record = Path(args.record).expanduser().absolute()
    if record.resolve(strict=True) != record or not record.is_dir():
        raise ValueError("Select the original canonical native record directory.")

    def retained(path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError("Use the original regular native record: " + str(path))
            raw = stream.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ValueError("Native materialization record exceeds 8 MiB.")
            if storage.stable(info) != storage.stable(os.fstat(stream.fileno())):
                raise ValueError("The original native record changed while reading.")
        return json.loads(raw), hashlib.sha256(raw).hexdigest()

    def select(path, value):
        raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if path.exists():
            if path.is_symlink() or path.read_bytes() != raw:
                raise ValueError("This finalization already selects another original stage.")
            return
        fd, name = tempfile.mkstemp(prefix=".dependency-finalization-", dir=record)
        try:
            with os.fdopen(fd, "wb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(name, path, follow_symlinks=False)
            except FileExistsError:
                if path.is_symlink() or path.read_bytes() != raw:
                    raise ValueError("Concurrent finalization selects another original stage.")
        finally:
            Path(name).unlink(missing_ok=True)

    lease = os.open(record / "dependency-finalization.lock",
                    os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lease)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
            raise ValueError("Keep the original finalization lease private.")
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old, report_sha = retained(record / REPORT)
        outcome, outcome_sha = retained(record / "result.json")
        if (report_sha != args.expected_report_sha256 or old.get("method") != "materialize"
                or old.get("outcome") != "error" or outcome.get("state") not in
                {"failed", "cancelled", "stopped"}):
            raise ValueError("Select the exact terminal materialization failure.")
        original = outcome.get("artifacts", {}).get("retention", {}).get("binding", {})
        if not original.get("operation_id") or original.get("project") != str(Path(old["destination"]).parent):
            raise ValueError("The terminal result does not bind this original dependency project.")
        chosen = old.get("materialization", {})
        stage = chosen.get("stage")
        if not stage or chosen.get("schema") != storage.SCHEMA:
            raise ValueError("The original failure does not retain its prepared stage.")
        project = Path(old["destination"]).parent
        lockfile = Path(old["lockfile"]["path"])
        if project.resolve(strict=True) != project or lockfile.parent != project:
            raise ValueError("Original project and lockfile selection changed.")
        if hashlib.sha256(lockfile.read_bytes()).hexdigest() != old["lockfile"]["sha256"]:
            raise ValueError("The original selected lockfile changed.")
        selected = SimpleNamespace(
            borrow_node_modules=old["source"]["selected_path"],
            materialize_borrowed=True,
            reuse_node_modules=[s["path"] for s in chosen["sources"][1:]],
            immutable_source_reference=chosen["immutable_reference"],
            omit=old["omit"],
            target_os=old["target"].get("os"),
            target_cpu=old["target"].get("cpu"),
            target_libc=old["target"].get("libc"))
        plan = borrow.build_plan(selected, lockfile, project, capture_materialization=True)
        if (plan.get("outcome") != "planned"
                or plan.get("inventory_sha256") != old["inventory_sha256"]
                or plan.get("materialization", {}).get("selection_sha256") != chosen["selection_sha256"]):
            raise ValueError("The complete original dependency selection changed: " +
                             json.dumps(plan.get("errors", [])))
        stage_identity = {"device": args.stage_device, "inode": args.stage_inode,
                          "selection_sha256": chosen["selection_sha256"]}
        receipt_identity = {"device": args.receipt_device, "inode": args.receipt_inode}
        intent = {"schema": "commons.node_dependency_completion/v1",
                  "record": str(record), "operation_id": original["operation_id"],
                  "original_report_sha256": report_sha, "original_result_sha256": outcome_sha,
                  "stage": stage, "stage_identity": stage_identity,
                  "receipt_identity": receipt_identity, "destination": old["destination"],
                  "inventory_sha256": old["inventory_sha256"],
                  "lockfile_sha256": old["lockfile"]["sha256"]}
        # The old native result remains its original historical outcome. This
        # original stage continuation has a separate, exact completion record.
        select(record / "dependency-finalization-intent.json", intent)
        if retained(record / REPORT)[1] != report_sha or retained(record / "result.json")[1] != outcome_sha:
            raise ValueError("Original native failure changed before completion.")
        result = storage.finalize_complete_stage(
            plan["materialization"], plan.pop("_materialization"),
            stage_path=stage, stage_identity=stage_identity,
            receipt_identity=receipt_identity, original_report_sha256=report_sha)
        completed = {**intent, "outcome": "materialized", "materialization": result}
        save_json(record / "dependency-finalization.json", completed)
        from runtime_consumers import refresh
        refresh(record)
        print(json.dumps(completed), flush=True)
        return 0
    finally:
        os.close(lease)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    command = []
    if "--" in argv:
        split = argv.index("--")
        command, argv = argv[split + 1:], argv[:split]
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    from swarm_cloud_worker import storage_options
    from swarm_cloud_job import launch_options
    for action in ("plan", "prepare"):
        child = sub.add_parser(action)
        if action == "prepare":
            launch_options(child)
            child.add_argument("--detach", action="store_true",
                               help="start through the original native supervisor on a persistent VM shell")
        else:
            child.add_argument("peer")
            child.add_argument("--project", required=True)
            child.add_argument("--java", choices=("17", "21"))
            child.add_argument("--node", choices=("18", "24"))
            storage_options(child)
            child.add_argument("--out", help="save the complete plan to a new private file")
        recovery_options(child)
    for action in ("register", "consumers", "release"):
        child = sub.add_parser(action, help="observe shared dependency use through original native records")
        if action == "consumers":
            child.add_argument("--path", required=True)
            child.add_argument("--runtime-consumers-root")
        else:
            child.add_argument("--record", required=True, help="existing original native job record directory")
            if action == "register":
                from runtime_consumers import runtime_options
                runtime_options(child)
    complete = sub.add_parser("finalize", help="publish the complete original stage after its final receipt allocation failed")
    complete.add_argument("--record", required=True)
    complete.add_argument("--expected-report-sha256", required=True)
    complete.add_argument("--stage-device", required=True, type=int)
    complete.add_argument("--stage-inode", required=True, type=int)
    complete.add_argument("--receipt-device", required=True, type=int)
    complete.add_argument("--receipt-inode", required=True, type=int)
    internal = sub.add_parser("_prepare", help=argparse.SUPPRESS)
    internal.add_argument("--project", required=True)
    internal.add_argument("--expected-lockfile-sha256", required=True)
    internal.add_argument("--expected-borrow-sha256")
    internal.add_argument("--report", required=True)
    internal.add_argument("--scratch-root", required=True)
    recovery_options(internal)
    args = parser.parse_args(argv)
    try:
        if args.action == "finalize":
            if command:
                raise ValueError("Finalize the retained layout before selecting its original next command.")
            return finalize(args)
        if args.action in ("register", "consumers", "release"):
            if command:
                raise ValueError("Register existing work without a second native command")
            import runtime_consumers as usage
            if args.action == "register":
                report = usage.register(args.record, selected_paths=args.runtime_path,
                                        registry_root=args.runtime_consumers_root)
            elif args.action == "release":
                report = usage.release(args.record)
            else:
                report = usage.consumers(args.path, registry_root=args.runtime_consumers_root)
            print(json.dumps(report, indent=2, ensure_ascii=True))
            return 0 if args.action != "release" or report.get("released") else 75
        if args.action == "plan":
            if command:
                raise ValueError("A native command follows prepare only.")
            report, _ = plan(args)
            print_plan(report, args.out)
            return recovery_code(report["recovery"])
        if args.action == "prepare":
            return prepare(args, command)
        return run_preparation(args, command)
    except BlockingIOError as exc:
        print(json.dumps({"schema": SCHEMA, "outcome": "busy", "message": str(exc)}), file=sys.stderr)
        return 75
    except (OSError, ValueError, RuntimeError, KeyError, cache.package_cache.SourceError) as exc:
        print(json.dumps({"schema": SCHEMA, "outcome": "error", "error": type(exc).__name__,
                          "message": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

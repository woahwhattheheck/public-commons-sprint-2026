"""Finish all six native helper executables without rebuilding completed targets.

Cloud/build-machine command around the maintained helper producer. A persistent
--work directory holds one source edition, completed target bundles and the final
archive. --reuse-bundle accepts actual existing producer output directories.
No package downloads, scientific runs, recipient changes or hosted CI are started.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid

if __package__:
    from . import build_native_helper_bundle as producer
else:
    import build_native_helper_bundle as producer

TARGETS = ("windows-x86_64", "macos-x86_64", "macos-arm64")
SCHEMA = "upstate.native-helper-completion/v1"


def _fingerprint(value: dict) -> str:
    body = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Expected an object in " + str(path))
    return value


def _retire(path: Path) -> None:
    """Retain unusable/interrupted bytes, rather than deleting an earlier build."""
    if path.exists() or path.is_symlink():
        destination = path.with_name(path.name + ".retained-" + uuid.uuid4().hex)
        path.rename(destination)
        print("Retained earlier bytes: " + str(destination), file=sys.stderr)


@contextmanager
def _held(work: Path):
    work.mkdir(parents=True, exist_ok=True)
    with (work / ".completion.lock").open("a+b") as stream:
        if stream.seek(0, os.SEEK_END) == 0:
            stream.write(b"\0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError("Another helper completion process uses " + str(work)) from error
        # Closing the handle releases the OS lock, including after interruption.
        yield


def _inputs(application: Path, zig: Path, minimum_macos: str) -> tuple[dict, dict[str, bytes]]:
    sources: dict[str, bytes] = {}
    tools = {}
    for tool in producer.TOOLS:
        closure = producer.source_closure(application, tool)
        tools[tool] = {}
        for name, body in closure.items():
            if name in sources and sources[name] != body:
                raise ValueError("Source changed while selecting its edition: " + name)
            sources[name] = body
            tools[tool][name] = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    for name, body in sources.items():
        if producer.member(application, name).read_bytes() != body:
            raise ValueError("Source changed while selecting its edition: " + name)
    version = subprocess.run([str(zig), "version"], check=True, capture_output=True, text=True).stdout.strip()
    compiler = {"kind": "zig-c++", "version": version, "sha256": producer.sha256(zig)}
    licenses = {name: producer.sha256(zig.parent / name) for name in producer.LICENSES
                if (zig.parent / name).is_file()}
    if not licenses:
        raise FileNotFoundError("Use the complete supplied Zig distribution, including its licenses")
    plan = {"schema": SCHEMA, "targets": list(TARGETS), "tools": tools,
            "compiler": compiler, "licenses": licenses, "minimum_macos": minimum_macos,
            "producer_sha256": producer.sha256(Path(producer.__file__))}
    return plan, sources


def _snapshot(root: Path, sources: dict[str, bytes]) -> None:
    for name, body in sources.items():
        path = producer.member(root, name)
        if path.is_file() and not path.is_symlink() and path.read_bytes() == body:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".source-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)


def _check_target(manifest: dict, target: str, plan: dict) -> dict:
    specification = manifest["platforms"][target]
    for tool in producer.TOOLS:
        entry = specification["tools"][tool]
        rows = entry.get("source_files", [])
        observed = {row["path"]: {"bytes": row["bytes"], "sha256": row["sha256"]}
                    for row in rows}
        if len(observed) != len(rows) or observed != plan["tools"][tool]:
            raise ValueError(target + "/" + tool + " uses another source/header edition")
        build = entry["build"]
        if build["compiler"] != plan["compiler"]:
            raise ValueError(target + "/" + tool + " uses another compiler edition")
        arguments = build["arguments"]
        required = ["-std=c++17", "-O2", "-fno-fast-math", "-mcpu=baseline"]
        required += ["-municode", "-static"] if target.startswith("windows-") else [
            "-mmacosx-version-min=" + plan["minimum_macos"]]
        if any(argument not in arguments for argument in required):
            raise ValueError(target + "/" + tool + " has different compile settings")
    expected_licenses = {
        "source_tools/native_helper_binaries/licenses/" + name.replace("/", "-") + ".txt": digest
        for name, digest in plan["licenses"].items()}
    observed_licenses = {row["path"]: row["sha256"] for row in specification.get("licenses", [])}
    if observed_licenses != expected_licenses:
        raise ValueError(target + " has a different compiler/runtime license closure")
    return specification


def _import_target(source: Path, specification: dict, target: str, destination: Path) -> None:
    stage = Path(tempfile.mkdtemp(prefix=".helper-import-", dir=destination.parent))
    try:
        rows = list(specification.get("licenses", []))
        for tool in producer.TOOLS:
            entry = specification["tools"][tool]
            rows.extend([entry, *entry["source_files"]])
        copied = set()
        for row in rows:
            name = row["path"]
            if name in copied:
                continue
            copied.add(name)
            incoming, outgoing = producer.member(source, name), producer.member(stage, name)
            outgoing.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(incoming, outgoing)
        producer.atomic_json(stage / "NATIVE_HELPERS.json", {
            "schema": producer.SCHEMA, "producer": "ECO-HELPER-COMPLETE-H63/1",
            "platforms": {target: specification}})
        producer.inspect_bundle(stage)
        os.replace(stage, destination)
    except BaseException:
        print("Retained import workspace: " + str(stage), file=sys.stderr)
        raise


def _matches(path: Path, seal: dict) -> bool:
    return (not path.is_symlink() and path.is_file()
            and path.stat().st_size == seal.get("bytes")
            and producer.sha256(path) == seal.get("sha256"))


def _archive(combined: Path, cache: Path) -> tuple[Path, dict]:
    archive, seal_path = cache / "Native_Helpers.zip", cache / "archive.json"
    manifest_digest = producer.sha256(combined / "NATIVE_HELPERS.json")
    if archive.exists() and seal_path.is_file():
        try:
            seal = _read_json(seal_path)
            if seal.get("manifest_sha256") == manifest_digest and _matches(archive, seal):
                return archive, seal
        except (OSError, ValueError, KeyError, TypeError):
            pass
    _retire(archive)
    _retire(seal_path)
    staged = cache / (".archive-" + uuid.uuid4().hex + ".zip")
    try:
        producer.make_zip(combined, staged)
        # Keep a completed archive recoverable even if the next rename is interrupted.
        seal = {"bytes": staged.stat().st_size, "sha256": producer.sha256(staged),
                "manifest_sha256": manifest_digest}
        # Windows FlushFileBuffers requires a write-capable archive handle.
        with staged.open("r+b" if os.name == "nt" else "rb") as stream:
            os.fsync(stream.fileno())
        producer.atomic_json(seal_path, seal)
        os.replace(staged, archive)
        return archive, seal
    except BaseException:
        print("Retained archive workspace: " + str(staged), file=sys.stderr)
        raise


def _publish(archive: Path, output: Path, seal: dict) -> bool:
    """Publish complete bytes create-only; an existing matching ZIP is reusable."""
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() or output.is_symlink():
        if _matches(output, seal):
            return False
        raise FileExistsError("Preserve the different existing ZIP: " + str(output))
    fd, name = tempfile.mkstemp(prefix=".native-helpers-", suffix=".zip", dir=output.parent)
    staged = Path(name)
    try:
        with os.fdopen(fd, "wb") as outgoing, archive.open("rb") as incoming:
            shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        if not _matches(staged, seal):
            raise ValueError("Copied ZIP differs from the completed archive")
        try:
            if os.name == "nt":
                # Windows rename is create-only; POSIX rename would overwrite.
                os.rename(staged, output)
            else:
                # Same-directory hard link publishes atomically without replacing a peer's ZIP.
                os.link(staged, output)
                staged.unlink()
        except FileExistsError:
            if not _matches(output, seal):
                raise
            staged.unlink(missing_ok=True)
            return False
        return True
    except BaseException:
        print("Completed archive retained at: " + str(archive), file=sys.stderr)
        if staged.exists():
            print("Publication copy retained at: " + str(staged), file=sys.stderr)
        raise


def complete(application: Path, work: Path, output: Path, *, zig: Path,
             minimum_macos: str = "11.0", reuse_bundles: list[Path] | None = None) -> dict:
    application, work, zig = application.resolve(strict=True), work.resolve(), zig.resolve(strict=True)
    output = output.expanduser().absolute()
    if not minimum_macos or any(not piece.isdigit() for piece in minimum_macos.split(".")):
        raise ValueError("minimum_macos must be a numeric dotted version")
    with _held(work):
        plan, sources = _inputs(application, zig, minimum_macos)
        fingerprint = _fingerprint(plan)
        cache = work / fingerprint
        plan_path = cache / "plan.json"
        if cache.exists():
            try:
                compatible = _read_json(plan_path) == plan
            except (OSError, ValueError):
                compatible = False
            if not compatible:
                _retire(cache)
        cache.mkdir(parents=True, exist_ok=True)
        producer.atomic_json(plan_path, plan)
        snapshot = cache / "source"
        _snapshot(snapshot, sources)
        candidates = {}
        for supplied in reuse_bundles or []:
            root = supplied.resolve(strict=True)
            manifest = producer.inspect_bundle(root)
            for target in TARGETS:
                if target not in manifest["platforms"]:
                    continue
                specification = _check_target(manifest, target, plan)
                if target in candidates and candidates[target][1] != specification:
                    raise ValueError("Different supplied bundles both select " + target)
                candidates[target] = (root, specification)
        state = {"schema": SCHEMA, "fingerprint": fingerprint, "targets": {},
                 "started_at": datetime.now(timezone.utc).isoformat()}
        status_path = cache / "completion.json"
        expected = {}
        reused, built, imported = [], [], []
        for target in TARGETS:
            destination = cache / target
            try:
                if destination.exists():
                    try:
                        manifest = producer.inspect_bundle(destination)
                        if set(manifest["platforms"]) != {target}:
                            raise ValueError("Expected exactly one cached native target")
                        expected[target] = _check_target(manifest, target, plan)
                        reused.append(target)
                    except (OSError, ValueError, KeyError, TypeError):
                        _retire(destination)
                if target not in expected:
                    state["targets"][target] = {"state": "importing" if target in candidates else "building"}
                    producer.atomic_json(status_path, state)
                    if target in candidates:
                        root, specification = candidates[target]
                        _import_target(root, specification, target, destination)
                        imported.append(target)
                    else:
                        producer.build(snapshot, destination, [target], zig=zig, minimum_macos=minimum_macos)
                        built.append(target)
                    manifest = producer.inspect_bundle(destination)
                    expected[target] = _check_target(manifest, target, plan)
                state["targets"][target] = {"state": "complete", "directory": target}
                producer.atomic_json(status_path, state)
                print("Completed native target: " + target, file=sys.stderr, flush=True)
            except BaseException as error:
                state["targets"][target] = {"state": "interrupted" if isinstance(error, KeyboardInterrupt) else "failed",
                                           "error_type": type(error).__name__, "message": str(error)[-8000:]}
                try:
                    producer.atomic_json(status_path, state)
                except OSError:
                    pass
                raise
        combined = cache / "combined"
        if combined.exists():
            try:
                if producer.inspect_bundle(combined)["platforms"] != expected:
                    raise ValueError("Combined payload differs from its completed targets")
            except (OSError, ValueError, KeyError, TypeError):
                _retire(combined)
        if not combined.exists():
            producer.merge(combined, [cache / target for target in TARGETS])
        archive, seal = _archive(combined, cache)
        published = _publish(archive, output, seal)
        result = {"schema": SCHEMA, "fingerprint": fingerprint, "output": str(output),
                  "bytes": seal["bytes"], "sha256": seal["sha256"], "targets": list(TARGETS),
                  "built": built, "imported": imported, "reused": reused, "published": published,
                  "combined_directory": str(combined), "completed_archive": str(archive)}
        state["result"] = result
        state["completed_at"] = datetime.now(timezone.utc).isoformat()
        producer.atomic_json(status_path, state)
        return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--zig", type=Path, required=True)
    parser.add_argument("--minimum-macos", default="11.0")
    parser.add_argument("--reuse-bundle", type=Path, action="append", default=[])
    args = parser.parse_args(argv)
    try:
        result = complete(args.application, args.work, args.output, zig=args.zig,
                          minimum_macos=args.minimum_macos, reuse_bundles=args.reuse_bundle)
    except KeyboardInterrupt:
        print("Build interrupted. Resume with the same --work directory and inputs.", file=sys.stderr)
        return 130
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        print("Completed target bundles remain under " + str(args.work), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

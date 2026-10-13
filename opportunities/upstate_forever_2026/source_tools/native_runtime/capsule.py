"""Complete offline InVEST environment capsules; no model scheduler or driver fork."""
from __future__ import annotations

import email
import time
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile

from . import probe
from .transport import (BLOCK, atomic_json, canonical, check_descriptor, contained,
                        copy_verified, descriptor, file_hash, lock, read_json,
                        regular, safe_relative, stamp, verify_file)

SCHEMA = "upstate.native-runtime-capsule/v1"
HERE = Path(__file__).resolve().parent
MAX_METADATA = 8 * BLOCK
REQUIRED = ("natcap-invest", "gdal", "pygeoprocessing", "taskgraph", "numpy", "scipy",
            "rasterio", "fiona", "shapely", "pyproj", "pandas", "reportlab", "matplotlib", "pillow")


def normalized(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def environment(prefix=None, offline=False):
    """No inherited Python injection or pip destination/config overrides."""
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("PYTHON", "PIP_", "CONDA_"))
           and key not in ("VIRTUAL_ENV", "GDAL_DATA", "PROJ_LIB", "PROJ_DATA")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONNOUSERSITE"] = "1"
    env["PIP_CONFIG_FILE"] = os.devnull
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["PIP_NO_INPUT"] = "1"
    if offline:
        env["PIP_NO_INDEX"] = "1"
    if prefix:
        prefix = Path(prefix)
        env["PATH"] = str(prefix / "bin") + os.pathsep + env.get("PATH", "")
        env["CONDA_PREFIX"] = str(prefix)
    return env


def command(arguments, log, *, cwd=None, prefix=None, offline=False, lease_fd=None):
    """Synchronous retained subprocess: actual child PID, complete file-backed output."""
    log = Path(log)
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("ab") as output:
        output.write(("\n--- " + stamp() + " ---\n").encode())
        output.flush()
        child = subprocess.Popen([str(v) for v in arguments], stdout=output,
                                 stderr=subprocess.STDOUT, cwd=cwd,
                                 env=environment(prefix, offline), start_new_session=True,
                                 pass_fds=() if lease_fd is None else (lease_fd,))
        print(json.dumps({"event": "native_runtime_child", "pid": child.pid,
                          "log": str(log)}, sort_keys=True), file=sys.stderr, flush=True)
        try:
            code = child.wait()
        except BaseException:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            raise
        output.flush()
        os.fsync(output.fileno())
    if code:
        raise RuntimeError(f"Native runtime command exited {code}; complete output: {log}")
    return code


def resolve_python(value):
    """Retain a venv's executable path: resolving its symlink loses that environment."""
    value = str(value)
    found = shutil.which(value) if not os.path.dirname(value) else value
    if not found:
        raise FileNotFoundError("Python executable not found: " + value)
    path = Path(found).absolute()
    if not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError("Python is not an executable file: " + str(path))
    return path


def python_identity(python):
    """Inspect the requested interpreter, not whichever Python runs this CLI."""
    python = resolve_python(python)
    code = ("import sys;sys.path.insert(0,sys.argv[1]);"
            "import probe,json;print(json.dumps(probe.identity(),sort_keys=True))")
    result = subprocess.run([str(python), "-B", "-c", code, str(HERE)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=environment(offline=True), check=False)
    if result.returncode:
        raise RuntimeError("Selected Python identity failed: " +
                           result.stderr.decode("utf-8", "replace"))
    value = json.loads(result.stdout)
    required = ("system", "machine", "implementation", "cache_tag", "soabi", "python")
    if any(not value.get(key) for key in required):
        raise ValueError("Selected interpreter returned incomplete ABI identity")
    return value


def probe_python(python, selection, directory, *, application=None, prefix=None, lease_fd=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    atomic_json(directory / "selection.json", selection)
    result = directory / "runtime-probe.json"
    if result.exists():
        os.replace(result, directory / "previous-runtime-probe.json")
    args = [str(python), "-B", str(HERE / "probe.py"),
            "--selection", str(directory / "selection.json"), "--output", str(result)]
    if application:
        args += ["--application", str(Path(application).resolve(strict=True))]
    error = None
    try:
        command(args, directory / "probe.log", prefix=prefix, offline=True, lease_fd=lease_fd)
    except RuntimeError as exc:
        error = exc
    if not result.is_file():
        raise error or RuntimeError("Native interpreter produced no probe result")
    value = read_json(result)
    if value.get("selection") != selection:
        raise ValueError("Probe returned a different native selection")
    if value.get("state") != "ready":
        return value
    if error:
        raise error
    return value


def wheel_info(path):
    """Inspect actual wheel metadata; capture all dependency requirements for operators."""
    path = regular(path)
    if path.suffix != ".whl":
        raise ValueError("Only built wheels belong in an offline wheelhouse")
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Wheel has duplicate members: " + path.name)
        for name in names:
            safe_relative(name.rstrip("/"))
        meta = [n for n in names if n.endswith(".dist-info/METADATA")]
        wheel = [n for n in names if n.endswith(".dist-info/WHEEL")]
        if len(meta) != 1 or len(wheel) != 1:
            raise ValueError("Wheel must contain one METADATA and WHEEL")
        for name in meta + wheel:
            if archive.getinfo(name).file_size > MAX_METADATA:
                raise ValueError("Oversized wheel metadata")
        fields = email.message_from_bytes(archive.read(meta[0]))
        tags = email.message_from_bytes(archive.read(wheel[0]))
        if not fields["Name"] or not fields["Version"]:
            raise ValueError("Wheel has no name/version")
        return {"name": normalized(fields["Name"]), "version": fields["Version"],
                "requires_python": fields["Requires-Python"],
                "requires_dist": fields.get_all("Requires-Dist", []),
                "tags": tags.get_all("Tag", [])}


def private_path_check(name):
    parts = PurePosixPath(name).parts
    prohibited = {".ssh", ".aws", ".netrc", ".pypirc", ".git-credentials"}
    if any(part in prohibited for part in parts):
        raise ValueError("Credential/configuration path is outside a runtime capsule: " + name)


def scan_conda(path):
    """Read all tar headers and declared destinations before unpacking any byte."""
    seen = set()
    total = 0
    links = {}
    with tarfile.open(path, "r:*") as archive:
        for member in archive:
            name = member.name.rstrip("/")
            safe_relative(name)
            private_path_check(name)
            if name in seen:
                raise ValueError("Duplicate conda archive member: " + name)
            seen.add(name)
            if member.isreg():
                total += member.size
            elif member.isdir():
                pass
            elif member.issym() or member.islnk():
                target = member.linkname
                if not target or PurePosixPath(target).is_absolute() or "\\" in target or "\x00" in target:
                    raise ValueError("Unsafe conda archive link: " + name)
                base = PurePosixPath(name).parent if member.issym() else PurePosixPath()
                stack = list(base.parts)
                for part in PurePosixPath(target).parts:
                    if part == "..":
                        if not stack:
                            raise ValueError("Conda archive link escapes prefix: " + name)
                        stack.pop()
                    elif part != ".":
                        stack.append(part)
                links[name] = "/".join(stack)
            else:
                raise ValueError("Conda archive contains a device/socket/FIFO: " + name)
        for name in seen:
            parents = PurePosixPath(name).parents
            if any(str(parent) in links for parent in parents):
                raise ValueError("Conda archive writes through a link: " + name)
        # Reject chained links whose final expansion would escape or cycle.
        for source in links:
            active = set()
            target = source
            while target in links:
                if target in active:
                    raise ValueError("Conda archive link cycle: " + source)
                active.add(target)
                target = links[target]
        if "bin/python" not in seen or "bin/conda-unpack" not in seen:
            raise ValueError("Select a complete conda-pack archive with bin/python and bin/conda-unpack")
    return {"members": len(seen), "unpacked_bytes": total}


def seal(payload, output, selection, target, *, kind, donor_probe=None, require_native=True):
    """Seal a complete wheel directory or an existing official conda-pack archive."""
    if kind not in ("wheelhouse", "conda-pack"):
        raise ValueError("kind must be wheelhouse or conda-pack")
    payload = Path(payload).resolve(strict=True)
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() or output.is_symlink():
        raise FileExistsError(output)
    with tempfile.TemporaryDirectory(prefix=".runtime-seal-", dir=output.parent) as temporary:
        stage = Path(temporary)
        (stage / "payload").mkdir()
        files = []
        packages = []
        archive_info = None
        if kind == "wheelhouse":
            if not payload.is_dir():
                raise ValueError("Wheelhouse payload must be a directory")
            candidates = sorted(payload.glob("*.whl"))
            if not candidates:
                raise ValueError("Wheelhouse is empty")
            known = set()
            for path in candidates:
                info = wheel_info(path)
                if info["name"] in known:
                    raise ValueError("Select one compatible wheel per package: " + info["name"])
                known.add(info["name"])
                destination = stage / "payload" / path.name
                copy_verified(path, destination)
                if wheel_info(destination) != info:
                    raise ValueError("Wheel metadata changed during capture: " + path.name)
                entry = descriptor(stage, destination)
                files.append(entry)
                packages.append({**info, **entry})
            if require_native:
                absent = set(REQUIRED) - known
                if absent:
                    raise ValueError("Incomplete native wheelhouse; missing " + ", ".join(sorted(absent)))
                invest = next(p for p in packages if p["name"] == "natcap-invest")
                if invest["version"] != selection["version"]:
                    raise ValueError("Wheelhouse contains a different InVEST version")
        else:
            regular(payload)
            archive_info = scan_conda(payload)
            destination = stage / "payload" / "runtime.tar.gz"
            copy_verified(payload, destination)
            files.append(descriptor(stage, destination))
        manifest = {"schema": SCHEMA, "kind": kind, "selection": selection,
                    "target": target, "files": files, "packages": packages,
                    "archive": archive_info, "created_at": stamp(),
                    "donor_probe": donor_probe,
                    "runtime_readiness": "requires receiving-host native probe",
                    "original_driver": "model.native.runtime / original Workspace.run"}
        atomic_json(stage / "capsule.json", manifest)
        temporary_zip = stage / "capsule.zip"
        with zipfile.ZipFile(temporary_zip, "x", compression=zipfile.ZIP_STORED,
                             allowZip64=True) as archive:
            archive.write(stage / "capsule.json", "capsule.json")
            for item in files:
                archive.write(stage / item["path"], item["path"])
        os.link(temporary_zip, output)
    return {"path": str(output), "bytes": output.stat().st_size,
            "sha256": file_hash(output), "manifest": manifest}


def read_capsule(path):
    regular(path)
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(set(names)) != len(names):
            raise ValueError("Capsule has duplicate archive members")
        for item in archive.infolist():
            safe_relative(item.filename)
            if stat.S_ISLNK(item.external_attr >> 16) or item.is_dir():
                raise ValueError("Capsule container accepts regular files only")
        if "capsule.json" not in names or archive.getinfo("capsule.json").file_size > MAX_METADATA:
            raise ValueError("Missing/oversized capsule metadata")
        # Reuse the strict duplicate-key JSON parser without unpacking the payload.
        with tempfile.TemporaryDirectory(prefix="runtime-metadata-") as temporary:
            source = Path(temporary) / "capsule.json"
            source.write_bytes(archive.read("capsule.json"))
            manifest = read_json(source)
        if manifest.get("schema") != SCHEMA or manifest.get("kind") not in ("wheelhouse", "conda-pack"):
            raise ValueError("Select a complete native-runtime capsule")
        expected = {"capsule.json"}
        for item in manifest["files"]:
            check_descriptor(item)
            if item["path"] in expected or not item["path"].startswith("payload/"):
                raise ValueError("Duplicate or misplaced payload declaration")
            expected.add(item["path"])
            info = archive.getinfo(item["path"])
            if info.file_size != item["bytes"]:
                raise ValueError("Payload size differs: " + item["path"])
        if expected != set(names):
            raise ValueError("Capsule member set differs from its complete manifest")
        if manifest["kind"] == "conda-pack" and len(manifest["files"]) != 1:
            raise ValueError("Conda capsule must contain exactly one complete runtime")
        if manifest["kind"] == "wheelhouse":
            if not manifest["files"] or any(not f["path"].endswith(".whl") for f in manifest["files"]):
                raise ValueError("Wheelhouse capsule contains a non-wheel payload")
    return manifest


def inspect_capsule(path):
    """Verify every payload without extracting or executing it; bounded-memory I/O."""
    path = regular(Path(path).resolve(strict=True))
    manifest = read_capsule(path)
    with zipfile.ZipFile(path) as archive:
        for item in manifest["files"]:
            checksum = hashlib.sha256()
            size = 0
            with archive.open(item["path"]) as stream:
                for data in iter(lambda: stream.read(BLOCK), b""):
                    checksum.update(data)
                    size += len(data)
            if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                raise ValueError("Changed capsule payload: " + item["path"])
    return {"state": "verified", "path": str(path), "bytes": path.stat().st_size,
            "sha256": file_hash(path), "manifest": manifest}


def extract_payload(capsule, destination, manifest):
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(capsule) as archive:
        for item in manifest["files"]:
            target = contained(destination, item["path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                verify_file(destination, item)
                continue
            fd, temporary = tempfile.mkstemp(prefix=".payload-", dir=target.parent)
            try:
                checksum = hashlib.sha256()
                size = 0
                with os.fdopen(fd, "wb") as output, archive.open(item["path"]) as source:
                    while data := source.read(BLOCK):
                        checksum.update(data)
                        size += len(data)
                        output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                    raise ValueError("Changed capsule payload: " + item["path"])
                os.link(temporary, target)
            finally:
                os.unlink(temporary)
    return destination


def compatible(manifest, current=None):
    current = current or probe.identity()
    target = manifest["target"]
    problems = []
    warnings = []
    for name in ("system", "machine"):
        if current.get(name) != target.get(name):
            problems.append(f"{name}: capsule {target.get(name)}, host {current.get(name)}")
    if manifest["kind"] == "wheelhouse":
        for name in ("implementation", "cache_tag", "soabi"):
            if current.get(name) != target.get(name):
                problems.append(f"{name}: capsule {target.get(name)}, host {current.get(name)}")
    libc = current.get("libc", ["", ""])
    donor_libc = target.get("libc", ["", ""])
    if libc[0] and donor_libc[0] and libc[0] != donor_libc[0]:
        warnings.append("Different C library families; receiving native probe determines usability")
    if libc[0] == donor_libc[0] == "glibc":
        def version(value):
            return tuple(int(p) for p in value.split("."))
        if version(libc[1]) < version(donor_libc[1]):
            warnings.append("Host glibc is older than the build host; receiving native probe determines library compatibility")
    return {"compatible": not problems, "problems": problems, "warnings": warnings, "current": current,
            "target": target, "native_probe_required": True}


def install(capsule, prefix, application, *, python=sys.executable, resume=False):
    """Install into one NEW final prefix, retaining all stages for explicit resume.

    The prefix is never renamed after conda-unpack: relocated absolute paths must
    remain final. A failed prefix is left owned by its capsule for recovery; an
    existing unowned environment is never modified or deleted.
    """
    capsule = regular(Path(capsule).resolve(strict=True))
    requested = Path(prefix).absolute()
    if requested.is_symlink():
        raise ValueError("Select a new runtime prefix, not a symlink")
    prefix = requested.resolve()
    application = Path(application).resolve(strict=True)
    if prefix == application or application.is_relative_to(prefix) or prefix.is_relative_to(application):
        raise ValueError("Keep runtime and original application in separate directories")
    if capsule.is_relative_to(prefix):
        raise ValueError("Keep the retained capsule outside its new runtime prefix")
    manifest = read_capsule(capsule)
    selected = probe.selected_source(application)
    if selected["version"] != manifest["selection"]["version"] or selected["source"] != manifest["selection"]["source"]:
        raise ValueError("Capsule and maintained application select different native model sources")
    python = resolve_python(python)
    current_identity = python_identity(python) if manifest["kind"] == "wheelhouse" else probe.identity()
    compatibility = compatible(manifest, current_identity)
    if not compatibility["compatible"]:
        raise ValueError("Incompatible runtime: " + "; ".join(compatibility["problems"]))
    capsule_sha = file_hash(capsule)
    parent = prefix.parent
    parent.mkdir(parents=True, exist_ok=True)
    operation = parent / ("." + prefix.name + ".native-runtime")
    with lock(parent / ("." + prefix.name + ".native-runtime.lock")) as lease_fd:
        state_path = operation / "receiving.json"
        if state_path.exists():
            state = read_json(state_path)
            if state["capsule_sha256"] != capsule_sha or state["prefix"] != str(prefix):
                raise ValueError("Runtime destination belongs to a different capsule")
            if not resume:
                raise ValueError("This owned installation exists; select --resume for its original capsule")
            if prefix.is_symlink():
                raise ValueError("Runtime prefix changed to a symlink")
        else:
            if prefix.exists() or operation.exists():
                raise ValueError("Choose a new runtime prefix; existing environments are preserved")
            operation.mkdir()
            state = {"schema": "upstate.native-runtime-receiving/v1", "capsule_sha256": capsule_sha,
                     "prefix": str(prefix), "application": str(application), "kind": manifest["kind"],
                     "created_at": stamp(), "stages": {}, "state": "receiving"}
            atomic_json(state_path, state)

        def stage(name, action):
            state.update(state="receiving", active_stage=name, updated_at=stamp())
            atomic_json(state_path, state)
            result = action()
            state["stages"][name] = {"state": "complete", "at": stamp()}
            atomic_json(state_path, state)
            return result

        try:
            payload = stage("receive_payload", lambda: extract_payload(capsule, operation, manifest))
            if manifest["kind"] == "wheelhouse":
                interpreter = prefix / "bin" / "python"
                if "create_environment" not in state["stages"]:
                    stage("create_environment", lambda: command(
                        [python, "-m", "venv", str(prefix)], operation / "create-environment.log", offline=True, lease_fd=lease_fd))
                lines = []
                for item in manifest["files"]:
                    wheel = verify_file(payload, item)
                    # File URIs handle spaces without requirement-line shell quoting.
                    lines.append(wheel.as_uri() + " --hash=sha256:" + item["sha256"])
                requirements = operation / "offline-wheel-lock.txt"
                requirements.write_text("\n".join(lines) + "\n", encoding="utf-8")
                stage("install_wheels", lambda: command(
                    [interpreter, "-m", "pip", "install", "--no-index", "--no-deps",
                     "--require-hashes", "--only-binary=:all:", "-r", requirements],
                    operation / "install-wheels.log", prefix=prefix, offline=True, lease_fd=lease_fd))
                stage("dependency_check", lambda: command(
                    [interpreter, "-m", "pip", "check"], operation / "dependency-check.log",
                    prefix=prefix, offline=True, lease_fd=lease_fd))
            else:
                original = verify_file(payload, manifest["files"][0])
                scan_conda(original)
                if "extract_environment" not in state["stages"]:
                    prefix.mkdir(exist_ok=True)
                    def unpack():
                        # Python's data filter additionally checks chained real paths.
                        with tarfile.open(original, "r:*") as archive:
                            archive.extractall(prefix, filter="data")
                    stage("extract_environment", unpack)
                interpreter = prefix / "bin" / "python"
                if "relocate_environment" not in state["stages"]:
                    stage("relocate_environment", lambda: command(
                        [interpreter, prefix / "bin" / "conda-unpack"],
                        operation / "relocate.log", prefix=prefix, offline=True, lease_fd=lease_fd))
            actual = stage("native_probe", lambda: probe_python(
                interpreter, selected, operation / "probe", application=application, prefix=prefix, lease_fd=lease_fd))
            state["probe"] = actual
            state["stages"]["native_probe"]["state"] = actual["state"]
            if actual["state"] != "ready":
                raise RuntimeError("Receiving native probe failed; see " + str(operation / "probe" / "runtime-probe.json"))
            state.pop("error", None)
            state.update(state="ready", python=str(interpreter), updated_at=stamp(),
                         application=str(application), compatibility=compatibility)
            atomic_json(state_path, state)
            return state
        except BaseException as exc:
            state.update(state="interrupted" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "failed",
                         error={"type": type(exc).__name__, "message": str(exc)}, updated_at=stamp())
            try:
                atomic_json(state_path, state)
            except OSError as recording_error:
                if hasattr(exc, "add_note"):
                    exc.add_note("Could not record installation failure: " + str(recording_error))
            raise


def _recover_capture_output(output, stage, state, request):
    """Reopen one published capsule after its original capture lost the response.

    The operation lease is held by capture_conda. Its retained request, complete
    original pack and donor probe establish ownership before any state is
    completed. No donor command or new packing work is required.
    """
    if output.is_symlink():
        raise ValueError("Captured runtime output cannot be a symlink")
    original = state.get("complete_archive")
    donor = state.get("sealing_probe", state.get("donor_probe"))
    if original is None or not isinstance(donor, dict) or donor.get("state") != "ready":
        raise ValueError("Published output has no complete original owned capture")
    original_path = verify_file(stage, original)
    inspected = inspect_capsule(output)
    manifest = inspected["manifest"]
    expected_payload = {"path": "payload/runtime.tar.gz",
                        "bytes": original["bytes"], "sha256": original["sha256"]}
    if (manifest["kind"] != "conda-pack"
            or manifest["selection"] != request["selection"]
            or manifest["target"] != donor.get("identity")
            or manifest.get("donor_probe") != donor
            or manifest["files"] != [expected_payload]
            or manifest.get("archive") != scan_conda(original_path)):
        raise ValueError("Published capsule differs from this original owned capture")
    captured = {key: inspected[key] for key in ("path", "bytes", "sha256")}
    if state.get("capsule") is not None and state["capsule"] != captured:
        raise ValueError("Completed capture capsule bytes changed")
    state.update(state="complete", capsule=captured,
                 completed_at=state.get("completed_at") or stamp())
    state.pop("error", None)
    atomic_json(stage / "capture.json", state)
    return {**captured, "manifest": manifest, "reused": True}


def capture_conda(prefix, application, output, *, pack_python=sys.executable, resume=False):
    """Use maintained conda-pack relocation; keep complete logs on every outcome.

    Capturing reads the existing donor, never installs into it. Resume reuses
    a verified complete original pack. An already-published owned capsule is
    reopened without another donor probe or packing command.
    """
    prefix = Path(prefix).resolve(strict=True)
    if not (prefix / "conda-meta").is_dir():
        raise ValueError("Select the actual existing conda prefix, not a venv or application directory")
    application = Path(application).resolve(strict=True)
    output = Path(output).absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.is_symlink():
        raise ValueError("Captured runtime output cannot be a symlink")
    if output.is_relative_to(prefix):
        raise ValueError("Keep captured output outside the donor environment")
    selected = probe.selected_source(application)
    pack_python = resolve_python(pack_python)
    stage = output.with_name("." + output.name + ".capture")
    request = {"prefix": str(prefix), "application": str(application),
               "selection": selected, "pack_python": str(pack_python), "output": str(output)}
    with lock(output.with_name("." + output.name + ".capture.lock")) as lease_fd:
        state_path = stage / "capture.json"
        if state_path.exists():
            state = read_json(state_path)
            if not resume or state["request"] != request:
                raise ValueError("Resume only this original owned capture with --resume")
        else:
            if output.exists():
                raise FileExistsError("Published output has no original capture request: " + str(output))
            if stage.exists():
                raise ValueError("Existing capture directory is unowned")
            stage.mkdir()
            state = {"request": request, "state": "capturing", "started_at": stamp()}
            atomic_json(state_path, state)
        try:
            if output.exists() or output.is_symlink():
                return _recover_capture_output(output, stage, state, request)
            actual = probe_python(prefix / "bin" / "python", selected, stage / "probe",
                                  application=application, prefix=prefix, lease_fd=lease_fd)
            if actual["state"] != "ready":
                raise RuntimeError("Donor native probe failed; see " + str(stage / "probe" / "runtime-probe.json"))
            archive = stage / "runtime.tar.gz"
            saved = state.get("complete_archive")
            if saved:
                verify_file(stage, saved)
                if actual["packages"] != state["donor_probe"]["packages"]:
                    raise ValueError("Donor packages changed after capture; choose a new output")
            else:
                if archive.exists():
                    archive.rename(stage / ("interrupted-runtime-" + str(time.time_ns()) + ".tar.gz"))
                code = "import conda_pack,sys; conda_pack.pack(prefix=sys.argv[1], output=sys.argv[2], format='tar.gz')"
                command([pack_python, "-c", code, prefix, archive], stage / "conda-pack.log", lease_fd=lease_fd)
                scan_conda(archive)
                state.update(complete_archive=descriptor(stage, archive), donor_probe=actual)
                atomic_json(state_path, state)
            # Retain the exact probe used by this publication before create-only
            # sealing, including a resumed capture's fresh compatible probe.
            state["sealing_probe"] = actual
            atomic_json(state_path, state)
            result = seal(archive, output, selected, actual["identity"], kind="conda-pack", donor_probe=actual)
            state.update(state="complete", capsule={k: result[k] for k in ("path", "bytes", "sha256")}, completed_at=stamp())
            state.pop("error", None)
            atomic_json(state_path, state)
            return result
        except BaseException as exc:
            state.update(state="failed", error={"type": type(exc).__name__, "message": str(exc)}, updated_at=stamp())
            try:
                atomic_json(state_path, state)
            except OSError as recording_error:
                if hasattr(exc, "add_note"):
                    exc.add_note("Could not record capture failure: " + str(recording_error))
            raise


def build_wheelhouse(requirements, destination, *, python=sys.executable, cache=None):
    """Build once on the equipped connected donor; keep its reusable package cache.

    This deliberately does not install into that donor or run any model. Supply
    the project's selected requirements, with natcap.invest pinned to its native
    source version and a GDAL binding matching the installed native GDAL library.
    """
    requirements = regular(Path(requirements).resolve(strict=True))
    python = resolve_python(python)
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with lock(destination / ".build.lock") as lease_fd:
        request = {"requirements_sha256": file_hash(requirements), "python": str(python), "identity": python_identity(python)}
        state = destination / "build.json"
        if state.exists():
            old = read_json(state)
            if old["request"] != request:
                raise ValueError("This wheelhouse belongs to a different requirements/interpreter selection")
        else:
            if any(p.name != ".build.lock" for p in destination.iterdir()):
                raise ValueError("Select a new wheelhouse directory or resume its original build.json")
        wheels = destination / "wheels"
        wheels.mkdir(exist_ok=True)
        cache = Path(cache).resolve() if cache else destination / "cache"
        args = [python, "-m", "pip", "wheel", "--wheel-dir", wheels,
                "--cache-dir", cache, "-r", requirements]
        atomic_json(state, {"request": request, "state": "building", "started_at": stamp()})
        try:
            command(args, destination / "build.log", lease_fd=lease_fd)
            packages = [{**wheel_info(path), **descriptor(destination, path)} for path in sorted(wheels.glob("*.whl"))]
            result = {"request": request, "state": "complete", "wheels": packages,
                      "completed_at": stamp(), "directory": str(wheels)}
            atomic_json(state, result)
            return result
        except BaseException as exc:
            atomic_json(state, {"request": request, "state": "failed", "error": str(exc),
                                "updated_at": stamp()})
            raise

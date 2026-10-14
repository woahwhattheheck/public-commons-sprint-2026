"""Acquire a complete selected conda package set and move it between build hosts.

The solver runs on the network-equipped build host. No target Python, DLL,
post-link script or package code is executed by acquire/receive. Native linking
and the maintained prefix_pack writer remain separate operations.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from email.utils import parsedate_to_datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import zipfile

SCHEMA = "upstate.native-conda-cache/v1"
BLOCK = 1024 * 1024
CHANNEL = "https://conda.anaconda.org/conda-forge"
TARGETS = {"windows-x86_64": "win-64", "macos-x86_64": "osx-64",
           "macos-arm64": "osx-arm64", "linux-x86_64": "linux-64",
           "linux-arm64": "linux-aarch64"}
PREFIXES = {"win-64": "w64", "osx-64": "m64", "osx-arm64": "a64",
            "linux-64": "l64", "linux-aarch64": "la64"}
NAME = re.compile(r"^[A-Za-z0-9_.+\-]+$")
DIGEST = {"sha256": re.compile(r"^[0-9a-f]{64}$"), "md5": re.compile(r"^[0-9a-f]{32}$")}


class AcquisitionError(ValueError):
    pass


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def digests(path):
    sha, md5, size = hashlib.sha256(), hashlib.md5(), 0
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(BLOCK), b""):
            sha.update(block)
            md5.update(block)
            size += len(block)
    return {"bytes": size, "sha256": sha.hexdigest(), "md5": md5.hexdigest()}


def atomic_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path, value):
    atomic_bytes(path, canonical(value))


@contextmanager
def locked(work):
    work = Path(work).absolute()
    work.mkdir(parents=True, exist_ok=True)
    with (work / ".conda-cache.lock").open("a+b") as stream:
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            if not stream.read(1):
                stream.write(b"\0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield work
        finally:
            if os.name == "nt":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def read_environment(path):
    """Read the maintained scalar-only environment without a bootstrap dependency."""
    raw = Path(path).read_bytes()
    sections = {"channels": [], "dependencies": []}
    section = None
    for line in raw.decode("utf-8-sig").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line == line.lstrip() and re.fullmatch(r"name:\s*[\w.\-]+", stripped):
            section = None
        elif stripped in ("channels:", "dependencies:") and line == line.lstrip():
            section = stripped[:-1]
        elif section and re.fullmatch(r"\s+-\s+[^\s#]+\s*(?:#.*)?", line):
            sections[section].append(stripped[2:].split("#", 1)[0].strip())
        else:
            raise AcquisitionError("Unsupported environment YAML; retain scalar channels/dependencies: " + stripped)
    if sections["channels"] != ["conda-forge", "nodefaults"]:
        raise AcquisitionError("Use the maintained conda-forge/nodefaults environment")
    if not sections["dependencies"]:
        raise AcquisitionError("The environment has no dependencies")
    return raw, sections["dependencies"]


def package_record(value, subdir):
    row = dict(value)
    filename = row.get("fn") or row.get("filename")
    if not isinstance(filename, str) or not NAME.fullmatch(filename):
        raise AcquisitionError("Missing or invalid selected package filename")
    if not filename.endswith((".conda", ".tar.bz2")):
        raise AcquisitionError("Not a conda package: " + filename)
    url = row.get("url", "")
    parts = urlsplit(url)
    selected_subdir = row.get("subdir") or (parts.path.split("/")[-2] if url else None)
    if selected_subdir not in (subdir, "noarch"):
        raise AcquisitionError("Wrong package platform: " + filename)
    expected_url = CHANNEL + "/" + selected_subdir + "/" + filename
    if url and url != expected_url:
        raise AcquisitionError("Unexpected channel or credential-bearing URL: " + filename)
    build = row.get("build_string", row.get("build"))
    for key, val in (("name", row.get("name")), ("version", row.get("version")), ("build", build)):
        if not isinstance(val, str) or not NAME.fullmatch(val):
            raise AcquisitionError("Invalid package " + key + ": " + filename)
    found = {key: row[key].lower() for key in DIGEST if isinstance(row.get(key), str)}
    if not found or any(not DIGEST[key].fullmatch(value) for key, value in found.items()):
        raise AcquisitionError("Missing publisher checksum: " + filename)
    amount = row.get("size")
    if amount is not None and (not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0):
        raise AcquisitionError("Invalid package size: " + filename)
    depends = row.get("depends", [])
    if not isinstance(depends, list) or not all(isinstance(item, str) for item in depends):
        raise AcquisitionError("Invalid dependency metadata: " + filename)
    return {"name": row["name"], "version": row["version"], "build": build,
            "subdir": selected_subdir, "filename": filename, "url": expected_url,
            "publisher": found, "expected_bytes": amount, "depends": depends,
            "license": row.get("license"), "cache_path": "pkgs/" + selected_subdir + "/" + filename}


def selected_packages(solution, subdir, roots):
    if solution.get("success") is not True:
        raise AcquisitionError("The original solver did not return success")
    actions = solution.get("actions", {})
    # FETCH excludes packages already in the solver's cache. LINK is the full
    # new-prefix selection and must be the source of the transferable lock.
    rows = actions.get("LINK")
    if not isinstance(rows, list) or not rows:
        raise AcquisitionError("A new-prefix solver result with the complete actions.LINK list is required")
    fetched = {(r.get("name"), r.get("version"), r.get("build_string", r.get("build"))): r
               for r in actions.get("FETCH", [])}
    packages = []
    for row in rows:
        key = (row.get("name"), row.get("version"), row.get("build_string", row.get("build")))
        packages.append(package_record({**fetched.get(key, {}), **row}, subdir))
    by_name = {p["name"]: p for p in packages}
    if len(by_name) != len(packages) or len({p["cache_path"].casefold() for p in packages}) != len(packages):
        raise AcquisitionError("The selected set has duplicate package identities or colliding paths")
    for root in roots:
        match = re.fullmatch(r"([A-Za-z0-9_.+\-]+)(?:(==|>=|<=|=|>|<)([0-9]+(?:\.[0-9]+)*))?", root)
        if not match:
            raise AcquisitionError("Unsupported root constraint in this acquisition adapter: " + root)
        name, operator, pin = match.groups()
        if name not in by_name:
            raise AcquisitionError("The solve omitted a root dependency: " + root)
        if operator:
            actual = by_name[name]["version"]
            if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", actual):
                raise AcquisitionError("Review the selected non-release root version: " + actual)
            a, b = tuple(map(int, actual.split("."))), tuple(map(int, pin.split(".")))
            length = max(len(a), len(b))
            a, b = a + (0,) * (length - len(a)), b + (0,) * (length - len(b))
            valid = {"==": a == b, ">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b,
                     "=": actual == pin or (name != "natcap.invest" and actual.startswith(pin + "."))}[operator]
            if not valid:
                raise AcquisitionError("The solve changed a root version: " + root + " -> " + actual)
    for package in packages:
        for dependency in package["depends"]:
            name = re.split(r"[ <>=!~]", dependency, 1)[0]
            if not name.startswith("__") and name not in by_name:
                raise AcquisitionError("Incomplete solve: " + package["name"] + " requires " + dependency)
    return sorted(packages, key=lambda p: (p["subdir"], p["filename"]))


def matches(path, record):
    if not Path(path).is_file() or Path(path).is_symlink():
        return None
    value = digests(path)
    if record.get("expected_bytes") is not None and value["bytes"] != record["expected_bytes"]:
        return None
    if any(value[key] != digest for key, digest in record["publisher"].items()):
        return None
    if any(key in record and value[key] != record[key] for key in ("bytes", "sha256", "md5")):
        return None
    return value


def copy_verified(source, destination, record):
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + destination.name + ".", dir=destination.parent)
    try:
        with source.open("rb") as reader, os.fdopen(fd, "wb") as writer:
            shutil.copyfileobj(reader, writer, BLOCK)
            writer.flush()
            os.fsync(writer.fileno())
        result = matches(temporary, record)
        if result is None:
            raise AcquisitionError("Package changed or failed its publisher checksum: " + source.name)
        os.replace(temporary, destination)
        return result
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def acquire_package(record, work, caches, offline):
    destination = work / record["cache_path"]
    found = matches(destination, record)
    if found:
        return {**record, **found}
    if destination.exists():
        raise AcquisitionError("Retain the changed package for inspection: " + str(destination))
    for cache in caches:
        for source in (Path(cache) / record["filename"], Path(cache) / record["subdir"] / record["filename"],
                       Path(cache) / record["cache_path"]):
            if matches(source, record):
                return {**record, **copy_verified(source, destination, record)}
    if offline:
        raise AcquisitionError("Original package bytes missing from supplied caches: " + record["filename"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        fd, temporary = tempfile.mkstemp(prefix="." + destination.name + ".", dir=destination.parent)
        try:
            request = Request(record["url"], headers={"User-Agent": "Ecosystem-Software-Acquisition/1.0"})
            with os.fdopen(fd, "wb") as writer, urlopen(request, timeout=90) as response:
                for block in iter(lambda: response.read(BLOCK), b""):
                    writer.write(block)
                writer.flush()
                os.fsync(writer.fileno())
            result = matches(temporary, record)
            if result is None:
                raise AcquisitionError("Publisher checksum mismatch: " + record["filename"])
            os.replace(temporary, destination)
            return {**record, **result}
        except (URLError, TimeoutError, ConnectionError) as error:
            if isinstance(error, HTTPError) and error.code not in (408, 429, 500, 502, 503, 504):
                raise
            if attempt == 2:
                raise
            delay = attempt + 1
            if isinstance(error, HTTPError) and error.headers.get("Retry-After"):
                retry = error.headers["Retry-After"]
                try:
                    delay = max(delay, int(retry))
                except ValueError:
                    delay = max(delay, parsedate_to_datetime(retry).timestamp() - time.time())
                if delay > 120:
                    raise AcquisitionError("Publisher requested Retry-After " + retry + "; resume this same work later") from error
            time.sleep(delay)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    raise AcquisitionError("Package acquisition did not complete")


def solve(environment, work, manager, solution_path, offline):
    retained = work / "solver.json"
    if retained.exists():
        if solution_path and Path(solution_path).read_bytes() != retained.read_bytes():
            raise AcquisitionError("A different solver result belongs in a new work directory")
        return json.loads(retained.read_text(encoding="utf-8"))
    if solution_path:
        raw = Path(solution_path).read_bytes()
        value = json.loads(raw)
    else:
        if offline:
            raise AcquisitionError("Offline acquisition requires the original --solution JSON")
        command = [manager, "--no-rc", "--no-env", "create", "--root-prefix", str(work / "solver-cache"),
                   "--prefix", str(work / "solve-only"), "--platform", environment["subdir"],
                   "--file", str(work / "environment.yml"), "--strict-channel-priority", "--dry-run", "--json", "--yes"]
        write_json(work / "solver-command.json", {"argv": command})
        with (work / "solver.stdout.partial").open("wb") as out, (work / "solver.stderr.log").open("wb") as err:
            result = subprocess.run(command, stdout=out, stderr=err, check=False)
        raw = (work / "solver.stdout.partial").read_bytes()
        if result.returncode:
            raise AcquisitionError("Solver exited " + str(result.returncode) + "; see retained solver.stderr.log/stdout.partial")
        value = json.loads(raw)
    selected_packages(value, environment["subdir"], environment["roots"])
    atomic_bytes(retained, raw)
    return value


def transfer_stream(reader, writer, package):
    sha, md5, size = hashlib.sha256(), hashlib.md5(), 0
    for block in iter(lambda: reader.read(BLOCK), b""):
        if writer is not None:
            writer.write(block)
        sha.update(block)
        md5.update(block)
        size += len(block)
    if size != package["bytes"] or sha.hexdigest() != package["sha256"] or md5.hexdigest() != package["md5"]:
        raise AcquisitionError("Package changed during transfer: " + package["filename"])


def make_parts(work, selection, limit):
    if limit < 2 * BLOCK or limit > 500 * BLOCK:
        raise AcquisitionError("Select transfer volumes between 2 and 500 MiB")
    budget = limit - BLOCK
    groups, current, amount = [], [], 0
    for package in selection["packages"]:
        if package["bytes"] > budget:
            raise AcquisitionError("A package exceeds the selected part limit: " + package["filename"])
        if current and amount + package["bytes"] > budget:
            groups.append(current)
            current, amount = [], 0
        current.append(package)
        amount += package["bytes"]
    if current:
        groups.append(current)
    parts = []
    prefix = PREFIXES[selection["subdir"]]
    for number, packages in enumerate(groups, 1):
        name = prefix + "p" + str(number).zfill(3) + ".zip"
        output = work / name
        expected_members = [p["cache_path"] for p in packages]
        if not output.exists():
            fd, temporary = tempfile.mkstemp(prefix="." + name + ".", dir=work)
            os.close(fd)
            try:
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                    for package in packages:
                        source = work / package["cache_path"]
                        with source.open("rb") as reader, archive.open(package["cache_path"], "w", force_zip64=True) as writer:
                            transfer_stream(reader, writer, package)
                if os.path.getsize(temporary) > limit:
                    raise AcquisitionError("Transfer ZIP exceeds the selected byte limit")
                os.replace(temporary, output)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        else:
            # An interrupted producer can leave a finished volume before the
            # index write. Reuse its bodies only after comparing the selection.
            with zipfile.ZipFile(output) as archive:
                if archive.namelist() != expected_members:
                    raise AcquisitionError("Existing transfer volume belongs to another selection: " + name)
                for member, package in zip(archive.infolist(), packages):
                    if member.file_size != package["bytes"]:
                        raise AcquisitionError("Existing transfer volume has changed: " + name)
                    with archive.open(member) as reader:
                        transfer_stream(reader, None, package)
        parts.append({"filename": name, **digests(output), "members": expected_members})
    return {"schema": SCHEMA, "selection": selection, "parts": parts,
            "license_bodies": "Original archives retain all publisher-supplied metadata and info/licenses bodies"}



def stream_package(reader, writer, package):
    """Copy an original compressed package once, verifying publisher metadata."""
    sha, md5, size = hashlib.sha256(), hashlib.md5(), 0
    expected = package["expected_bytes"]
    for block in iter(lambda: reader.read(BLOCK), b""):
        size += len(block)
        if size > expected:
            raise AcquisitionError("Package exceeds its selected size: " + package["filename"])
        if writer is not None:
            writer.write(block)
        sha.update(block)
        md5.update(block)
    observed = {"bytes": size, "sha256": sha.hexdigest(), "md5": md5.hexdigest()}
    if size != expected or any(observed[key] != value for key, value in package["publisher"].items()):
        raise AcquisitionError("Publisher checksum or size mismatch: " + package["filename"])
    return {**package, **observed}


@contextmanager
def package_reader(package, work, caches, offline):
    """Borrow matching caches read-only; otherwise stream the original HTTPS URL."""
    for cache in [work, *map(Path, caches)]:
        candidates = (cache / package["filename"], cache / package["subdir"] / package["filename"],
                      cache / package["cache_path"])
        for source in candidates:
            if matches(source, package):
                with source.open("rb") as reader:
                    yield reader
                return
    if offline:
        raise AcquisitionError("Original package bytes missing from supplied caches: " + package["filename"])
    request = Request(package["url"], headers={"User-Agent": "Ecosystem-Software-Acquisition/1.0"})
    with urlopen(request, timeout=90) as reader:
        if urlsplit(reader.geturl()).scheme != "https":
            raise AcquisitionError("Package download redirected outside HTTPS: " + package["filename"])
        yield reader


def stream_parts(work, selection, caches, offline, limit):
    """Keep one compressed copy, in final transfer volumes, on a constrained host.

    Each volume is an independently committed unit. A dropped transfer retries
    only the current unfinished volume. Completed volumes retain their names,
    original package bodies and the existing receiver's manifest format.
    """
    if limit < 2 * BLOCK or limit > 500 * BLOCK:
        raise AcquisitionError("Select transfer volumes between 2 and 500 MiB")
    budget = limit - BLOCK
    groups, current, amount = [], [], 0
    for package in selection["packages"]:
        expected = package.get("expected_bytes")
        if not isinstance(expected, int) or isinstance(expected, bool) or expected <= 0:
            raise AcquisitionError("Streaming requires the original solver package size: " + package["filename"])
        if expected > budget:
            raise AcquisitionError("A package exceeds the selected part limit: " + package["filename"])
        if current and amount + expected > budget:
            groups.append(current)
            current, amount = [], 0
        current.append(package)
        amount += expected
    if current:
        groups.append(current)
    parts, completed = [], []
    prefix = PREFIXES[selection["subdir"]]
    for number, packages in enumerate(groups, 1):
        name = prefix + "p" + str(number).zfill(3) + ".zip"
        output = work / name
        expected_members = [p["cache_path"] for p in packages]
        if output.exists() or output.is_symlink():
            if output.is_symlink() or not output.is_file() or output.stat().st_size > limit:
                raise AcquisitionError("Changed existing transfer volume: " + name)
            found = []
            with zipfile.ZipFile(output) as archive:
                if archive.namelist() != expected_members:
                    raise AcquisitionError("Existing transfer volume belongs to another selection: " + name)
                for member, package in zip(archive.infolist(), packages):
                    if member.file_size != package["expected_bytes"]:
                        raise AcquisitionError("Existing transfer volume has changed: " + name)
                    with archive.open(member) as reader:
                        found.append(stream_package(reader, None, package))
        else:
            for attempt in range(3):
                # This reserved scratch name belongs to the request-bound work
                # directory and its kernel lock. Resume discards only that same
                # unfinished volume, including after process termination.
                temporary = work / ("." + name + ".streaming.partial")
                if temporary.is_symlink() or (temporary.exists() and not temporary.is_file()):
                    raise AcquisitionError("Unexpected streaming scratch path: " + str(temporary))
                if temporary.exists():
                    temporary.unlink()
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                os.close(fd)
                found = []
                try:
                    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                        for package in packages:
                            with package_reader(package, work, caches, offline) as reader:
                                with archive.open(package["cache_path"], "w", force_zip64=True) as writer:
                                    found.append(stream_package(reader, writer, package))
                    if os.path.getsize(temporary) > limit:
                        raise AcquisitionError("Transfer ZIP exceeds the selected byte limit")
                    # Commit the completed volume before publishing its identity.
                    with open(temporary, "r+b") as stream:
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(temporary, output)
                    break
                except (URLError, TimeoutError, ConnectionError) as error:
                    if isinstance(error, HTTPError) and error.code not in (408, 429, 500, 502, 503, 504):
                        raise
                    if attempt == 2:
                        raise
                    delay = attempt + 1
                    if isinstance(error, HTTPError) and error.headers.get("Retry-After"):
                        retry = error.headers["Retry-After"]
                        try:
                            delay = max(delay, int(retry))
                        except ValueError:
                            delay = max(delay, parsedate_to_datetime(retry).timestamp() - time.time())
                        if delay > 120:
                            raise AcquisitionError("Publisher requested Retry-After " + retry + "; resume this same work later") from error
                    time.sleep(delay)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
        completed.extend(found)
        part = {"filename": name, **digests(output), "members": expected_members}
        parts.append(part)
        write_json(work / "transfer-progress.json", {
            "schema": "upstate.native-conda-transfer-progress/v1",
            "target": selection["target"], "solver_sha256": selection["solver_sha256"],
            "environment_sha256": selection["environment_sha256"],
            "parts": parts, "completed_packages": completed,
            "total_packages": len(selection["packages"]), "total_parts": len(groups),
        })
        print(json.dumps({"part": part, "completed": len(completed),
                          "total": len(selection["packages"])}), flush=True)
    return {"schema": SCHEMA, "selection": {**selection, "packages": completed}, "parts": parts,
            "license_bodies": "Original archives retain all publisher-supplied metadata and info/licenses bodies"}

def acquire(args):
    raw, roots = read_environment(args.environment)
    request = {"schema": SCHEMA, "environment_sha256": hashlib.sha256(raw).hexdigest(),
               "target": args.target, "subdir": TARGETS[args.target], "roots": roots,
               "part_bytes": args.part_bytes}
    if getattr(args, "stream_volumes", False):
        request["transfer_mode"] = "stream-volumes"
    with locked(args.work) as work:
        prior = work / "request.json"
        if prior.exists() and json.loads(prior.read_text()) != request:
            raise AcquisitionError("This work directory already belongs to a different selection")
        write_json(prior, request)
        atomic_bytes(work / "environment.yml", raw)
        selected = solve(request, work, args.manager, args.solution, args.offline)
        packages = selected_packages(selected, request["subdir"], roots)
        caches = list(args.package_cache) + [str(work / "solver-cache" / "pkgs")]
        selection = {**request, "solver_sha256": digests(work / "solver.json")["sha256"], "packages": packages}
        if getattr(args, "stream_volumes", False):
            # The plan is the full original solve, available before byte acquisition.
            # Only the final selection/parts files assert complete received bytes.
            write_json(work / "selected-plan.json", selection)
            manifest = stream_parts(work, selection, caches, args.offline, args.part_bytes)
            selection = manifest["selection"]
            completed = selection["packages"]
        else:
            completed = []
            for package in packages:
                completed.append(acquire_package(package, work, caches, args.offline))
                print(json.dumps({"package": package["filename"], "completed": len(completed), "total": len(packages)}), flush=True)
            selection = {**selection, "packages": completed}
            manifest = None
        write_json(work / "selection.json", selection)
        lines = ["@EXPLICIT"] + [p["url"] + ("#" + p["md5"] if p.get("md5") else "") for p in completed]
        atomic_bytes(work / "upstream-explicit.txt", ("\n".join(lines) + "\n").encode())
        if manifest is None:
            manifest = make_parts(work, selection, args.part_bytes)
        write_json(work / "parts.json", manifest)
        return {"state": "complete", "manifest": str(work / "parts.json"),
                "packages": len(completed), "package_bytes": sum(p["bytes"] for p in completed),
                "parts": manifest["parts"]}


def receive(args):
    manifest_path = Path(args.manifest).resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != SCHEMA:
        raise AcquisitionError("Unrecognized package-transfer manifest")
    selection = manifest["selection"]
    subdir = TARGETS.get(selection.get("target"))
    if subdir != selection.get("subdir") or not subdir:
        raise AcquisitionError("Invalid target selection")
    packages = {}
    for package in selection["packages"]:
        normalized = package_record({**package, "fn": package["filename"], "size": package["bytes"],
                                     **package["publisher"]}, subdir)
        if normalized["cache_path"] != package["cache_path"] or package["cache_path"] in packages:
            raise AcquisitionError("Duplicate or changed package path")
        if not DIGEST["sha256"].fullmatch(package.get("sha256", "")):
            raise AcquisitionError("Package transfer SHA-256 is absent")
        packages[package["cache_path"]] = package
    assigned = [member for part in manifest["parts"] for member in part["members"]]
    if len(assigned) != len(set(assigned)) or set(assigned) != set(packages):
        raise AcquisitionError("Transfer volumes do not contain the exact complete selection")
    with locked(args.destination) as destination:
        retained = destination / "selection.json"
        if retained.exists() and json.loads(retained.read_text()) != selection:
            raise AcquisitionError("Destination belongs to another package selection")
        write_json(retained, selection)
        for part in manifest["parts"]:
            name = part["filename"]
            if not isinstance(name, str) or not NAME.fullmatch(name) or not name.endswith(".zip"):
                raise AcquisitionError("Invalid transfer volume name")
            path = manifest_path.parent / name
            observed = digests(path)
            if observed["bytes"] != part["bytes"] or observed["sha256"] != part["sha256"]:
                raise AcquisitionError("Transfer volume checksum mismatch: " + name)
            with zipfile.ZipFile(path) as archive:
                if archive.namelist() != part["members"]:
                    raise AcquisitionError("Unexpected or duplicate ZIP members: " + name)
                for member in part["members"]:
                    package = packages[member]
                    output = destination / member
                    if matches(output, package):
                        continue
                    if output.exists():
                        raise AcquisitionError("Changed receiving package: " + member)
                    if archive.getinfo(member).file_size != package["bytes"]:
                        raise AcquisitionError("Unexpected package size: " + member)
                    output.parent.mkdir(parents=True, exist_ok=True)
                    if not output.parent.resolve().is_relative_to(destination.resolve()):
                        raise AcquisitionError("Receiving parent escapes the selected destination")
                    fd, temporary = tempfile.mkstemp(prefix="." + output.name + ".", dir=output.parent)
                    try:
                        with archive.open(member) as reader, os.fdopen(fd, "wb") as writer:
                            shutil.copyfileobj(reader, writer, BLOCK)
                            writer.flush()
                            os.fsync(writer.fileno())
                        if not matches(temporary, package):
                            raise AcquisitionError("Received package checksum mismatch: " + member)
                        os.replace(temporary, output)
                    finally:
                        if os.path.exists(temporary):
                            os.unlink(temporary)
        lines = ["@EXPLICIT"] + [(destination / p["cache_path"]).as_uri() + "#" + p["md5"]
                                  for p in selection["packages"]]
        atomic_bytes(destination / "local-explicit.txt", ("\n".join(lines) + "\n").encode())
        return {"state": "received", "target": selection["target"], "packages": len(packages),
                "package_cache": str(destination / "pkgs"), "explicit": str(destination / "local-explicit.txt")}


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    command = commands.add_parser("acquire", help="solve once or adopt an existing solve, acquire all package bytes, and create transfer volumes")
    command.add_argument("--environment", required=True, type=Path)
    command.add_argument("--target", choices=TARGETS, required=True)
    command.add_argument("--work", required=True, type=Path)
    command.add_argument("--manager", default="micromamba", help="existing native-host micromamba executable")
    command.add_argument("--solution", type=Path, help="reuse the original complete new-prefix dry-run JSON")
    command.add_argument("--package-cache", action="append", default=[], help="read-only existing cache, may be repeated")
    command.add_argument("--offline", action="store_true")
    command.add_argument("--part-bytes", type=int, default=384 * BLOCK)
    command.add_argument("--stream-volumes", action="store_true",
                         help="stream original packages directly into transfer ZIPs without a duplicate local cache")
    command = commands.add_parser("receive", help="receive complete original packages and write a local explicit lock")
    command.add_argument("--manifest", required=True, type=Path)
    command.add_argument("--destination", required=True, type=Path)
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        result = acquire(args) if args.command == "acquire" else receive(args)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(json.dumps({"state": "failed", "error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

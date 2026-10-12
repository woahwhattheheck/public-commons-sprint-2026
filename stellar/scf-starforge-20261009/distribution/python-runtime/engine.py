#!/usr/bin/env python3
"""Exact Python environment receiving for the original Stellar Forge runtime.

The existing runtime workspace owns operation admission and customer commands.
This engine owns source snapshots, wheel cohorts and isolated installations.
"""
from __future__ import annotations

import argparse
import contextlib
import email.parser
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.parse
import urllib.request
import zipfile

SCHEMA = "stellar-forge.python-runtime-lock.v1"
TRANSFER = "stellar-forge.python-runtime-transfer.v1"
CHUNK = 262144
MAX_JSON = 8 * 1024 * 1024
MAX_SOURCE = 64 * 1024 * 1024
MAX_ARCHIVE = 2 * 1024 ** 3
PROGRESS = None
LEASES = ()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while data := stream.read(CHUNK):
            value.update(data)
    return value.hexdigest()


def need(condition, message):
    if not condition:
        raise ValueError(message)


def read(path):
    path = Path(path)
    need(path.stat().st_size <= MAX_JSON, "Runtime metadata exceeds the supported size")
    return json.loads(path.read_bytes())


def private(path):
    path = Path(path).absolute()
    need(not path.is_symlink(), "Runtime directory must be an owned directory")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(path.is_dir(), "Expected a runtime directory")
    return path


def publish(temporary, path):
    path = Path(path)
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def write(path, value, raw=False):
    path = Path(path)
    private(path.parent)
    data = value if raw else encoded(value)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        publish(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def identifier(value):
    need(isinstance(value, str) and re.fullmatch("[a-f0-9]{64}", value), "Expected the retained SHA256 identity")
    return value


def member(value):
    path = PurePosixPath(value)
    need(isinstance(value, str) and value and not path.is_absolute() and
         ".." not in path.parts and "." not in path.parts and "\\" not in value and
         path.as_posix() == value, "Invalid retained relative member")
    return value


def normalized(name):
    return re.sub("[-_.]+", "-", name).lower()


def progress(root, stage, **details):
    value = {"stage": stage, "updatedAt": time.time(), **details}
    write(root / "operation.json", value)
    if PROGRESS is not None:
        write(PROGRESS, value)
    return value


@contextlib.contextmanager
def owned(root, lease_fd):
    global LEASES
    root = private(root)
    fd = os.open(root / "engine.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("The original Python runtime operation still owns this directory") from None
        inherited = ()
        if lease_fd is not None:
            need(stat.S_ISREG(os.fstat(lease_fd).st_mode), "The original worker lease must be a regular file")
            inherited = (lease_fd,)
        LEASES = tuple(set((fd, *inherited)))
        yield
    finally:
        LEASES = ()
        os.close(fd)


def run(root, stage, argv, capture=False):
    logs = private(root / "logs")
    environment = {key: value for key, value in os.environ.items()
                   if key in ("PATH", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY",
                              "https_proxy", "http_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR")}
    environment.update(TMPDIR=str(private(root / "tmp")), PYTHONNOUSERSITE="1",
                       PYTHONDONTWRITEBYTECODE="1", PIP_DISABLE_PIP_VERSION_CHECK="1")
    argv = list(map(str, argv))
    record = progress(root, stage, state="RUNNING", startedAt=time.time(), argv=argv)
    with (logs / (stage + ".log")).open("ab") as log:
        child = subprocess.Popen(argv, cwd=root, env=environment, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE if capture else log, stderr=log, pass_fds=LEASES)
        progress(root, stage, **{key: value for key, value in record.items() if key not in ("stage", "updatedAt")}, pid=child.pid)
        try:
            output, _ = child.communicate()
        except BaseException:
            child.terminate()
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            raise
    progress(root, stage, state="COMPLETED" if child.returncode == 0 else "FAILED",
             exitCode=child.returncode, log=str(logs / (stage + ".log")), startedAt=record["startedAt"])
    need(child.returncode == 0, stage + " exited " + str(child.returncode) + "; read " + str(logs / (stage + ".log")))
    return (output or b"").decode() if capture else None


def python_info(root, python):
    python = str(Path(python).absolute())
    need(os.access(python, os.X_OK), "Select an executable Python interpreter")
    code = ("import importlib.metadata as m,json,platform,sys,sysconfig;"
            "print(json.dumps({'implementation':sys.implementation.name,'major':sys.version_info.major,"
            "'minor':sys.version_info.minor,'version':platform.python_version(),'platform':sysconfig.get_platform(),"
            "'machine':platform.machine(),'cacheTag':sys.implementation.cache_tag,'pip':m.version('pip')}))")
    info = json.loads(run(root, "python", [python, "-I", "-c", code], True))
    need((info["major"], info["minor"]) >= (3, 11), "The original Python application requires Python 3.11 or newer")
    need(int(info["pip"].split(".")[0]) >= 23, "The selected interpreter needs pip 23 or newer")
    return python, info


def platform_key(info):
    return {key: info[key] for key in ("implementation", "major", "minor", "platform", "machine", "cacheTag")}


def wheel_metadata(path):
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist() if name.endswith(".dist-info/METADATA")]
        need(len(names) == 1 and archive.getinfo(names[0]).file_size <= MAX_JSON, "Wheel has no single package metadata identity")
        data = email.parser.Parser().parsestr(archive.read(names[0]).decode())
    return {"name": normalized(data["Name"]), "version": data["Version"]}


def download(url, path, checksum):
    identifier(checksum)
    path = Path(path)
    if path.is_file() and digest(path) == checksum:
        return
    parsed = urllib.parse.urlsplit(url)
    need(parsed.scheme == "https" and parsed.hostname in ("pypi.org", "files.pythonhosted.org") and
         not parsed.username and not parsed.password, "Wheel download must use the original public PyPI host")
    private(path.parent)
    pending = path.with_name(path.name + ".partial")
    value = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=90) as response, pending.open("wb") as output:
        final = urllib.parse.urlsplit(response.url)
        need(final.scheme == "https" and final.hostname in ("pypi.org", "files.pythonhosted.org"),
             "Wheel transfer left the original PyPI host")
        total = 0
        while data := response.read(CHUNK):
            total += len(data)
            need(total <= MAX_ARCHIVE, "Wheel exceeds the receiving capacity")
            value.update(data)
            output.write(data)
        output.flush()
        os.fsync(output.fileno())
    need(value.hexdigest() == checksum, "Downloaded wheel differs from the resolver identity")
    publish(pending, path)


def named_requirements(values):
    need(isinstance(values, list) and all(isinstance(value, str) for value in values),
         "Package requirements must be an explicit list")
    for value in values:
        need(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?(?:[<>=!~]+[A-Za-z0-9.*+!_-]+(?:,[<>=!~]+[A-Za-z0-9.*+!_-]+)*)?", value),
             "Use original named public-package requirements for the selected runtime: " + value)
    return values


def source_snapshot(root, source, extras, release_id, release_digest):
    source = Path(source).absolute()
    need(source.is_dir() and not source.is_symlink(), "Select the original Python project directory")
    identifier(release_digest)
    need(isinstance(release_id, str) and 1 <= len(release_id) <= 160, "Retain the original source release identifier")
    raw = (source / "pyproject.toml").read_bytes()
    project = tomllib.loads(raw.decode())
    package = project["project"]
    need(normalized(package["name"]) == "stellar-forge-buyer", "Select the original Stellar Forge Python application")
    need(project["build-system"].get("build-backend") == "setuptools.build_meta", "The selected source must retain its original setuptools build backend")
    need("backend-path" not in project["build-system"], "Use the original declared package build backend")
    requires = named_requirements(project["build-system"]["requires"])
    named_requirements(package.get("dependencies", []))
    optional = package.get("optional-dependencies", {})
    need(set(extras) <= set(optional), "Select extras declared by the original Python project")
    for extra in extras:
        named_requirements(optional[extra])
    packages = project.get("tool", {}).get("setuptools", {}).get("packages")
    need(isinstance(packages, list) and packages and
         all(re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", name) for name in packages),
         "The original source must declare its package paths")
    paths = {"pyproject.toml"}
    readme = package.get("readme", "README.md")
    need(isinstance(readme, str), "Use the original file-backed package README")
    paths.add(member(readme))
    for filename in ("LICENSE", "LICENSE.md", "LICENSE.txt"):
        if (source / filename).is_file():
            paths.add(filename)
    for name in packages:
        directory = source.joinpath(*name.split("."))
        need(directory.is_dir() and not directory.is_symlink(), "Original Python package directory is missing")
        for path in directory.rglob("*"):
            need(not path.is_symlink(), "The source snapshot cannot follow a linked package member")
            if path.is_file() and "__pycache__" not in path.parts and path.suffix not in (".pyc", ".pyo"):
                paths.add(path.relative_to(source).as_posix())
    bodies, total = {}, 0
    for name in sorted(paths):
        path = source / member(name)
        need(path.is_file() and not path.is_symlink(), "Original source file is missing: " + name)
        body = path.read_bytes()
        total += len(body)
        need(total <= MAX_SOURCE and len(paths) <= 10000, "Original Python source exceeds the configured source capacity")
        bodies[name] = body
    need(bodies["pyproject.toml"] == raw, "Original project metadata changed during capture")
    descriptor = {"releaseId": release_id, "releaseDigest": release_digest, "name": normalized(package["name"]),
                  "version": package["version"], "requiresPython": package["requires-python"],
                  "scripts": package.get("scripts", {}), "packagePaths": [name.replace(".", "/") for name in packages],
                  "buildRequirements": requires, "extras": optional,
                  "files": [{"path": name, "bytes": len(body), "sha256": sha(body)} for name, body in bodies.items()]}
    source_id = sha(encoded(descriptor))
    destination = private(root / "sources" / source_id)
    for name, body in bodies.items():
        path = destination / name
        if path.exists():
            need(not path.is_symlink() and digest(path) == sha(body), "A retained original source member changed")
        else:
            write(path, body, True)
    write(destination / "SOURCE.json", descriptor)
    return {"id": source_id, **descriptor}, destination


def requirements_bytes(packages):
    return ("\n".join(item["name"] + "==" + item["version"] + " --hash=sha256:" + item["sha256"]
                      for item in packages) + "\n").encode()


def resolve_wheels(root, python, directory, requirements, local=None):
    directory = private(directory)
    report_path = directory / "resolution.json"
    if not report_path.exists():
        pending = directory / "resolution.pending.json"
        run(root, "resolve-" + directory.name, [python, "-I", "-m", "pip", "--isolated", "install", "--dry-run",
            "--ignore-installed", "--only-binary=:all:", "--no-cache-dir", "--index-url", "https://pypi.org/simple",
            "--report", pending, *requirements])
        report = read(pending)
        need(report.get("version") == "1" and isinstance(report.get("install"), list) and report["install"],
             "The resolver must return its supported complete installation report")
        write(report_path, report)
        pending.unlink(missing_ok=True)
    report = read(report_path)
    need(report.get("version") == "1", "Unsupported pip installation report")
    wheelhouse = private(directory / "wheels")
    packages, seen = [], set()
    for item in report["install"]:
        metadata, info = item["metadata"], item["download_info"]
        name, version = normalized(metadata["name"]), metadata["version"]
        checksum = identifier(info["archive_info"].get("hashes", {}).get("sha256"))
        url = info["url"]
        filename = Path(urllib.parse.unquote(urllib.parse.urlsplit(url).path)).name
        need(filename.endswith(".whl") and filename == Path(filename).name and name not in seen,
             "Resolve one binary wheel for every retained package")
        seen.add(name)
        destination = wheelhouse / filename
        if local is not None and name == local["name"]:
            need(version == local["version"] and checksum == local["sha256"] and filename == local["path"].name,
                 "The dependency resolver changed the original application wheel")
            if not destination.exists():
                pending = destination.with_name(destination.name + ".partial")
                with local["path"].open("rb") as original, pending.open("wb") as output:
                    shutil.copyfileobj(original, output, CHUNK)
                    output.flush()
                    os.fsync(output.fileno())
                publish(pending, destination)
            url = "original-source:" + local["sourceId"]
        else:
            download(url, destination, checksum)
        need(digest(destination) == checksum and wheel_metadata(destination) == {"name": name, "version": version},
             "Retained wheel metadata differs from its complete resolver identity")
        packages.append({"name": name, "version": version, "filename": filename, "sha256": checksum,
                         "bytes": destination.stat().st_size, "sourceUrl": url})
    packages.sort(key=lambda item: item["name"])
    write(directory / "requirements.lock", requirements_bytes(packages), True)
    return packages


def create_environment(root, python, directory):
    executable = directory / "bin/python"
    if not executable.exists():
        run(root, "create-environment", [python, "-I", "-m", "venv", "--without-pip", directory])
    need(executable.is_file(), "The selected environment did not create its interpreter")
    return executable


def install_wheels(root, python, target, directory):
    run(root, "install-" + directory.name, [python, "-I", "-m", "pip", "--isolated", "--python", target,
        "install", "--no-index", "--find-links", directory / "wheels", "--require-hashes", "--no-cache-dir",
        "--no-compile", "-r", directory / "requirements.lock"])
    run(root, "dependency-check", [python, "-I", "-m", "pip", "--isolated", "--python", target, "check"])


def check_source_wheel(path, source):
    with zipfile.ZipFile(path) as archive:
        for item in source["files"]:
            if not any(item["path"].startswith(prefix + "/") for prefix in source["packagePaths"]):
                continue
            need(item["path"] in archive.namelist(), "Original package source is absent from its built wheel: " + item["path"])
            body = archive.read(item["path"])
            need(len(body) == item["bytes"] and sha(body) == item["sha256"], "Built wheel changed the original package source")


def check_candidate(root, candidate_id):
    directory = root / "candidates" / identifier(candidate_id)
    lock = read(directory / "lock.json")
    need(lock.get("schema") == SCHEMA and lock.get("id") == candidate_id, "Choose a retained Python runtime cohort")
    request = {key: lock[key] for key in ("source", "extras", "interpreter")}
    need(sha(encoded(request)) == candidate_id, "The source/interpreter/extras cohort identity changed")
    need(digest(directory / "requirements.lock") == lock["requirementsSha256"] and
         (directory / "requirements.lock").read_bytes() == requirements_bytes(lock["packages"]),
         "The exact Python dependency lock changed")
    names, files = set(), set()
    for item in lock["packages"]:
        filename = member(item["filename"])
        need(Path(filename).name == filename and filename.endswith(".whl") and filename not in files and
             item["name"] not in names, "The wheel cohort contains a duplicate or invalid package")
        path = directory / "wheels" / filename
        need(not path.is_symlink() and path.stat().st_size == item["bytes"] and digest(path) == item["sha256"] and
             wheel_metadata(path) == {"name": item["name"], "version": item["version"]}, "A retained wheel changed")
        names.add(item["name"]); files.add(filename)
    need(set(path.name for path in (directory / "wheels").iterdir()) == files, "The wheel directory changed")
    own = [item for item in lock["packages"] if item["name"] == lock["source"]["name"]]
    need(len(own) == 1 and own[0]["version"] == lock["source"]["version"], "Original Python application wheel is missing")
    check_source_wheel(directory / "wheels" / own[0]["filename"], lock["source"])
    need(sha(encoded({key: value for key, value in lock["source"].items() if key != "id"})) == lock["source"]["id"],
         "Original Python source identity changed")
    return directory, lock


def candidate_view(root, candidate_id):
    directory, lock = check_candidate(root, candidate_id)
    expanded = 0
    for item in lock["packages"]:
        with zipfile.ZipFile(directory / "wheels" / item["filename"]) as archive:
            expanded += sum(entry.file_size for entry in archive.infolist())
    return {"id": candidate_id, "candidate": candidate_id, "directory": str(directory),
            "lockSha256": digest(directory / "lock.json"), "source": lock["source"], "extras": lock["extras"],
            "packages": lock["packages"], "interpreter": lock["interpreter"],
            "wheelBytes": sum(item["bytes"] for item in lock["packages"]), "unpackedBytes": expanded}


def resolve(root, python, source_path, extras, release_id, release_digest):
    python, interpreter = python_info(root, python)
    extras = sorted(set(filter(None, extras.split(","))))
    source, source_directory = source_snapshot(root, source_path, extras, release_id, release_digest)
    request = {"source": source, "extras": extras, "interpreter": platform_key(interpreter)}
    candidate_id = sha(encoded(request))
    directory = private(root / "candidates" / candidate_id)
    if (directory / "lock.json").exists():
        return candidate_view(root, candidate_id)
    write(directory / "request.json", request)
    build_id = sha(encoded({"requirements": source["buildRequirements"], "interpreter": platform_key(interpreter)}))
    build = private(root / "builders" / build_id)
    build_packages = resolve_wheels(root, python, build, source["buildRequirements"])
    builder = create_environment(root, python, build / "venv")
    if not (build / "ready.json").exists():
        install_wheels(root, python, builder, build)
        write(build / "ready.json", {"packages": build_packages})
    wheel_directory = private(build / "original-wheels" / source["id"])
    existing = list(wheel_directory.glob("*.whl"))
    if not existing:
        run(root, "build-original", [python, "-I", "-m", "pip", "--isolated", "--python", builder,
            "wheel", "--no-index", "--no-build-isolation", "--no-deps", "--no-cache-dir",
            "--wheel-dir", wheel_directory, source_directory])
        existing = list(wheel_directory.glob("*.whl"))
    need(len(existing) == 1, "Original source build must produce one application wheel")
    original = existing[0]
    metadata = wheel_metadata(original)
    need(metadata == {"name": source["name"], "version": source["version"]}, "Built application package identity differs")
    check_source_wheel(original, source)
    requirements = [str(original) + ("[" + ",".join(extras) + "]" if extras else "")]
    packages = resolve_wheels(root, python, directory, requirements,
        {**metadata, "path": original, "sha256": digest(original), "sourceId": source["id"]})
    lock = {"schema": SCHEMA, "id": candidate_id, **request, "packages": packages,
            "resolutionPython": interpreter, "buildPackages": build_packages,
            "requirementsSha256": digest(directory / "requirements.lock")}
    write(directory / "lock.json", lock)
    return candidate_view(root, candidate_id)


def application_modules(source):
    modules = {"analysis": "stellar_forge_buyer.analysis_workspace",
               "workbooks": "stellar_forge_buyer.analysis_workbooks",
               "workbookDelivery": "stellar_forge_buyer.workbook_client"}
    if source.get("scripts", {}).get("stellar-forge-duckdb") == "stellar_forge_buyer.duckdb_cli:main":
        modules["duckdb"] = "stellar_forge_buyer.duckdb_cli"
    return modules


def verify_installation(root, directory, lock):
    python = directory / "venv/bin/python"
    checks = [item for item in lock["source"]["files"]
              if any(item["path"].startswith(prefix + "/") for prefix in lock["source"]["packagePaths"])]
    code = ("import importlib.metadata as m,importlib.util,sys,json,pathlib,hashlib;"
            "d=m.distribution(sys.argv[1]); checks=json.loads(sys.argv[2]);"
            "print(json.dumps({'prefix':sys.prefix,'packages':[{'name':x.metadata['Name'],'version':x.version} for x in m.distributions()],"
            "'files':[{'path':c['path'],'bytes':len(d.locate_file(c['path']).read_bytes()),"
            "'sha256':hashlib.sha256(d.locate_file(c['path']).read_bytes()).hexdigest()} for c in checks],"
            "'entrypoints':{e.name:e.value for e in d.entry_points if e.group=='console_scripts'},"
            "'modules':{n:bool(importlib.util.find_spec(n)) for n in json.loads(sys.argv[3])}}))")
    inventory = json.loads(run(root, "installed-source", [python, "-I", "-c", code,
        lock["source"]["name"], json.dumps(checks), json.dumps(list(application_modules(lock["source"]).values()))], True))
    actual = {normalized(item["name"]): item["version"] for item in inventory["packages"]}
    need(actual == {item["name"]: item["version"] for item in lock["packages"]} and len(actual) == len(inventory["packages"]),
         "Installed packages differ from the complete selected wheel cohort")
    need(inventory["files"] == checks and inventory["entrypoints"] == lock["source"]["scripts"],
         "Installed original source or command entrypoints changed")
    need(all(inventory["modules"].values()), "An original customer application module is missing")
    need(Path(inventory["prefix"]).resolve() == (directory / "venv").resolve(), "Installed interpreter selected another environment")
    for name in inventory["entrypoints"]:
        need(Path(name).name == name and os.access(directory / "venv/bin" / name, os.X_OK), "An original console entrypoint is missing")
    return inventory


def install(root, candidate_id, python):
    candidate, lock = check_candidate(root, candidate_id)
    python, interpreter = python_info(root, python)
    need(platform_key(interpreter) == lock["interpreter"], "Select a wheel cohort resolved for this Python interpreter and platform")
    installation_id = digest(candidate / "lock.json")
    directory = private(root / "installations" / installation_id)
    intent = {"candidate": candidate_id, "lockSha256": installation_id, "interpreter": lock["interpreter"]}
    if (directory / "intent.json").exists():
        need(read(directory / "intent.json") == intent, "This environment belongs to another retained installation")
    write(directory / "intent.json", intent)
    executable = create_environment(root, python, directory / "venv")
    if not (directory / "installation.json").exists():
        install_wheels(root, python, executable, candidate)
    verify_installation(root, directory, lock)
    manifest = {"schema": "stellar-forge.python-runtime-installation.v1", "id": installation_id,
                "installation": installation_id, "candidate": candidate_id, "lockSha256": installation_id,
                "directory": str(directory), "python": str(executable), "source": lock["source"],
                "extras": lock["extras"], "packages": lock["packages"], "interpreter": lock["interpreter"],
                "capabilities": {"analysis": True, **{name: name in lock["extras"] for name in lock["source"]["extras"]}},
                "modules": application_modules(lock["source"]),
                "entrypoints": {name: {"target": target, "path": str(directory / "venv/bin" / name),
                                      "sha256": digest(directory / "venv/bin" / name)}
                                for name, target in lock["source"]["scripts"].items()}}
    if (directory / "installation.json").exists():
        need(read(directory / "installation.json") == manifest, "The original installation manifest changed")
    write(directory / "installation.json", manifest)
    return manifest


def installed(root, installation_id, verify=False):
    directory = root / "installations" / identifier(installation_id)
    manifest = read(directory / "installation.json")
    need(manifest["id"] == installation_id and manifest["directory"] == str(directory) and
         manifest["python"] == str(directory / "venv/bin/python"), "The selected installation manifest changed")
    candidate, lock = check_candidate(root, manifest["candidate"])
    need(digest(candidate / "lock.json") == installation_id and manifest["source"] == lock["source"] and
         manifest["extras"] == lock["extras"] and manifest["packages"] == lock["packages"],
         "The installation differs from its original source and wheel lock")
    expected_entrypoints = {name: {"target": target, "path": str(directory / "venv/bin" / name),
                                  "sha256": digest(directory / "venv/bin" / name)}
                            for name, target in lock["source"]["scripts"].items()}
    need(manifest["entrypoints"] == expected_entrypoints, "The retained original command binding changed")
    if verify:
        verify_installation(root, directory, lock)
    return manifest


def bundle(root, candidate_id, output):
    directory, lock = check_candidate(root, candidate_id)
    output = Path(output).absolute()
    need(not output.is_symlink(), "The cohort archive must be an owned regular file")
    need(not output.is_relative_to(directory), "Keep the receiving archive outside its original cohort")
    members = {"lock.json": directory / "lock.json", "requirements.lock": directory / "requirements.lock"}
    members.update({"wheels/" + item["filename"]: directory / "wheels" / item["filename"] for item in lock["packages"]})
    manifest = {"schema": TRANSFER, "candidate": candidate_id, "lockSha256": digest(directory / "lock.json"),
                "sourceId": lock["source"]["id"],
                "files": [{"path": name, "bytes": path.stat().st_size, "sha256": digest(path)} for name, path in members.items()]}
    if output.exists():
        with zipfile.ZipFile(output) as archive:
            need(json.loads(archive.read("COHORT.json")) == manifest and
                 set(archive.namelist()) == set(members) | {"COHORT.json"} and
                 len(archive.namelist()) == len(members) + 1, "Existing archive belongs to another wheel cohort")
            for item in manifest["files"]:
                value = hashlib.sha256()
                need(archive.getinfo(item["path"]).file_size == item["bytes"], "Existing archive member length changed")
                with archive.open(item["path"]) as original:
                    while data := original.read(CHUNK):
                        value.update(data)
                need(value.hexdigest() == item["sha256"], "Existing archive member changed")
        return {"path": str(output), "sha256": digest(output), "bytes": output.stat().st_size,
                "candidate": candidate_id, "lockSha256": manifest["lockSha256"], "sourceId": manifest["sourceId"]}
    private(output.parent)
    pending = output.with_name(output.name + ".partial")
    with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, path in members.items():
            archive.write(path, name)
        archive.writestr("COHORT.json", encoded(manifest))
    with pending.open("rb") as complete:
        os.fsync(complete.fileno())
    publish(pending, output)
    return {"path": str(output), "sha256": digest(output), "bytes": output.stat().st_size,
            "candidate": candidate_id, "lockSha256": manifest["lockSha256"], "sourceId": manifest["sourceId"]}


def receive(root, archive_path):
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        need(len(infos) <= 2000 and len({entry.filename for entry in infos}) == len(infos), "The receiving cohort repeats members")
        need(sum(entry.file_size for entry in infos) <= MAX_ARCHIVE, "The receiving cohort exceeds its total capacity")
        for entry in infos:
            member(entry.filename)
            need(not entry.is_dir() and not stat.S_ISLNK(entry.external_attr >> 16), "The receiving cohort contains an unsupported member")
        need(archive.getinfo("COHORT.json").file_size <= MAX_JSON and archive.getinfo("lock.json").file_size <= MAX_JSON,
             "Receiving cohort metadata exceeds the supported size")
        manifest = json.loads(archive.read("COHORT.json"))
        need(manifest.get("schema") == TRANSFER, "Select the original Python wheel cohort transfer")
        candidate_id = identifier(manifest["candidate"])
        lock_bytes = archive.read("lock.json")
        need(sha(lock_bytes) == manifest["lockSha256"], "The transferred wheel lock changed")
        lock = json.loads(lock_bytes)
        need(lock.get("id") == candidate_id and lock.get("source", {}).get("id") == manifest["sourceId"],
             "The transferred source or candidate identity differs")
        files = {member(item["path"]): item for item in manifest["files"]}
        need(len(files) == len(manifest["files"]) and set(files) | {"COHORT.json"} == set(archive.namelist()),
             "The transfer inventory does not cover the exact complete cohort")
        expected = {"lock.json", "requirements.lock"} | {"wheels/" + member(item["filename"]) for item in lock["packages"]}
        need(set(files) == expected, "The wheel transfer contains files outside its retained cohort")
        directory = private(root / "candidates" / candidate_id)
        # The lock is published last, after every wheel and requirement has landed.
        for name in sorted(files, key=lambda value: value == "lock.json"):
            item = files[name]
            need(archive.getinfo(name).file_size == item["bytes"], "A transfer member length differs")
            destination = directory / name
            if destination.exists():
                need(not destination.is_symlink() and destination.stat().st_size == item["bytes"] and
                     digest(destination) == item["sha256"], "An existing receiving member differs")
                continue
            private(destination.parent)
            pending = destination.with_name(destination.name + ".partial")
            checksum = hashlib.sha256()
            with archive.open(name) as original, pending.open("wb") as out:
                while data := original.read(CHUNK):
                    checksum.update(data); out.write(data)
                out.flush(); os.fsync(out.fileno())
            need(checksum.hexdigest() == item["sha256"], "Transferred original wheel bytes differ")
            publish(pending, destination)
    return candidate_view(root, candidate_id)


def inspect(root, candidate_id=None, installation_id=None):
    if candidate_id:
        return candidate_view(root, candidate_id)
    if installation_id:
        return installed(root, installation_id, True)
    active_path = root / "active.json"
    return {"schema": "stellar-forge.python-runtime-inventory.v1",
            "candidates": [candidate_view(root, path.name) for path in sorted((root / "candidates").glob("*")) if (path / "lock.json").is_file()],
            "installations": [installed(root, path.name) for path in sorted((root / "installations").glob("*")) if (path / "installation.json").is_file()],
            "active": read(active_path) if active_path.exists() else None}


def activate(root, installation_id, expected):
    manifest = installed(root, installation_id, True)
    path = root / "active.json"
    previous = read(path) if path.exists() else None
    # A committed selection is the same operation result after a worker reconnect.
    if previous and previous["installation"] == installation_id:
        return previous
    if expected is not None:
        expected_id = identifier(expected) if expected else None
        need((previous or {}).get("installation") == expected_id, "The selected active Python installation changed")
    value = {"installation": installation_id, "python": manifest["python"], "entrypoints": manifest["entrypoints"],
             "source": manifest["source"], "extras": manifest["extras"], "activatedAt": time.time(),
             "previousInstallation": (previous or {}).get("installation")}
    write(path, value)
    return value


def main():
    global PROGRESS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--lease-fd", type=int)
    parser.add_argument("--progress-file")
    sub = parser.add_subparsers(dest="command", required=True)
    selected = sub.add_parser("resolve")
    for name in ("python", "source", "release-id", "release-digest"):
        selected.add_argument("--" + name, required=True)
    selected.add_argument("--extras", default="workbooks")
    selected = sub.add_parser("install")
    selected.add_argument("--candidate", required=True)
    selected.add_argument("--python", required=True)
    selected = sub.add_parser("inspect")
    group = selected.add_mutually_exclusive_group()
    group.add_argument("--candidate"); group.add_argument("--installation")
    selected = sub.add_parser("bundle")
    selected.add_argument("--candidate", required=True); selected.add_argument("--output", required=True)
    selected = sub.add_parser("receive"); selected.add_argument("--archive", required=True)
    selected = sub.add_parser("activate")
    selected.add_argument("--installation", required=True); selected.add_argument("--expected-installation")
    args = parser.parse_args()
    root = private(args.root)
    PROGRESS = Path(args.progress_file).absolute() if args.progress_file else None
    with owned(root, args.lease_fd):
        if args.command == "resolve":
            result = resolve(root, args.python, args.source, args.extras, args.release_id, args.release_digest)
        elif args.command == "install":
            result = install(root, args.candidate, args.python)
        elif args.command == "inspect":
            result = inspect(root, args.candidate, args.installation)
        elif args.command == "bundle":
            result = bundle(root, args.candidate, args.output)
        elif args.command == "receive":
            result = receive(root, args.archive)
        else:
            result = activate(root, args.installation, args.expected_installation)
        progress(root, "complete", command=args.command, state="COMPLETED", result=result)
        print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"state": "FAILED", "code": "PYTHON_RUNTIME_ERROR", "message": str(error)}), file=sys.stderr)
        raise SystemExit(1)

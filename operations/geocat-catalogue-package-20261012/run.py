#!/usr/bin/env python3
"""One admitted GeoCat source/package/install/receiving lifetime."""
from __future__ import annotations
import argparse, copy, fcntl, hashlib, importlib.util, json, os, shutil, stat
import subprocess, sys, tarfile, time, zipfile
from pathlib import Path
from types import SimpleNamespace

def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def need(value, code):
    if not value: raise RuntimeError(code)

def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()

def snapshot(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def regular(path):
    path = Path(path)
    need(path.is_absolute() and path.resolve(strict=True) == path, "EXACT_REGULAR_PATH_REQUIRED")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd); raise RuntimeError("REGULAR_FILE_REQUIRED")
    return fd

def file_digest(path):
    fd = regular(path)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno()); h = hashlib.sha256()
        for part in iter(lambda: stream.read(1024 * 1024), b""): h.update(part)
        need(snapshot(before) == snapshot(os.fstat(stream.fileno())) == snapshot(Path(path).lstat()),
             "SOURCE_FILE_CHANGED_DURING_READ")
        return {"bytes": before.st_size, "sha256": h.hexdigest()}

def save(path, data, *, replace=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(path.parent.resolve(strict=True) == path.parent, "OUTPUT_PARENT_CHANGED")
    if not replace and os.path.lexists(path):
        need(stat.S_ISREG(path.lstat().st_mode) and path.read_bytes() == data, "EXISTING_OUTPUT_CHANGED")
        return path
    tmp = path.with_name("." + path.name + ".write-" + str(os.getpid()))
    try:
        with tmp.open("xb") as stream:
            os.chmod(tmp, 0o600); stream.write(data); stream.flush(); os.fsync(stream.fileno())
        if replace:
            if os.path.lexists(path): need(stat.S_ISREG(path.lstat().st_mode), "REPLACE_REGULAR_OUTPUT_ONLY")
            os.replace(tmp, path)
        else: os.link(tmp, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(parent)
        finally: os.close(parent)
    finally:
        if os.path.lexists(tmp): tmp.unlink()
    return path

def save_json(path, value, **options):
    return save(path, json_bytes(value), **options)

def copy_file(source, destination, *, expected=None):
    source, destination = Path(source), Path(destination)
    if os.path.lexists(destination):
        observed = file_digest(destination); wanted = expected or file_digest(source)
        need(observed == wanted, "EXISTING_COPY_CHANGED")
        return observed
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(destination.parent.resolve(strict=True) == destination.parent, "COPY_PARENT_CHANGED")
    tmp = destination.with_name("." + destination.name + ".copy-" + str(os.getpid()))
    try:
        with os.fdopen(regular(source), "rb") as incoming, tmp.open("xb") as outgoing:
            before = os.fstat(incoming.fileno()); h = hashlib.sha256(); count = 0
            os.chmod(tmp, 0o600)
            for block in iter(lambda: incoming.read(1024 * 1024), b""):
                outgoing.write(block); h.update(block); count += len(block)
            outgoing.flush(); os.fsync(outgoing.fileno())
            need(snapshot(before) == snapshot(os.fstat(incoming.fileno())) == snapshot(source.lstat()), "COPY_SOURCE_CHANGED")
            observed = {"bytes": count, "sha256": h.hexdigest()}
            need(expected is None or observed == expected, "COPY_SOURCE_IDENTITY_CHANGED")
        os.link(tmp, destination)
        need(file_digest(destination) == observed, "COPY_READBACK_CHANGED")
        return observed
    finally:
        if os.path.lexists(tmp): tmp.unlink()

def copy_retained_graph(source, destination, inventory_file):
    """Receive the complete existing graph; preserve original links and modes."""
    source, destination = Path(source), Path(destination)
    need(source.resolve(strict=True) == source and source.is_dir() and not source.is_symlink(), "RETAINED_GRAPH_ROOT_CHANGED")
    need(not os.path.lexists(destination), "RETAINED_GRAPH_DESTINATION_EXISTS")
    destination.mkdir(mode=0o700)
    directories, rows, counts = [], [], {"files": 0, "bytes": 0, "links": 0}
    def visit(before_dir, after_dir):
        before = before_dir.lstat(); need(stat.S_ISDIR(before.st_mode), "GRAPH_DIRECTORY_REQUIRED")
        names = sorted(os.listdir(before_dir)); directories.append((before_dir, snapshot(before), names))
        for name in names:
            src, dst = before_dir / name, after_dir / name
            info = src.lstat(); rel = src.relative_to(source).as_posix()
            if stat.S_ISDIR(info.st_mode):
                dst.mkdir(mode=0o700); visit(src, dst); os.chmod(dst, stat.S_IMODE(info.st_mode))
            elif stat.S_ISREG(info.st_mode):
                observed = copy_file(src, dst); os.chmod(dst, stat.S_IMODE(info.st_mode))
                rows.append({"path": rel, "kind": "file", "mode": stat.S_IMODE(info.st_mode), **observed})
                counts["files"] += 1; counts["bytes"] += observed["bytes"]
            elif stat.S_ISLNK(info.st_mode):
                target = os.readlink(src); need(not os.path.isabs(target), "GRAPH_LINK_MUST_REMAIN_RELATIVE")
                resolved = src.resolve(strict=True)
                need(resolved == source or source in resolved.parents, "GRAPH_LINK_ESCAPES_RETAINED_ROOT")
                need(snapshot(src.lstat()) == snapshot(info), "GRAPH_LINK_CHANGED")
                os.symlink(target, dst); rows.append({"path": rel, "kind": "symlink", "target": target}); counts["links"] += 1
            else: raise RuntimeError("GRAPH_SPECIAL_FILE_UNSUPPORTED")
    visit(source, destination)
    for path, identity, names in directories:
        need(snapshot(path.lstat()) == identity and sorted(os.listdir(path)) == names, "RETAINED_GRAPH_DIRECTORY_CHANGED")
    for row in rows:
        if row["kind"] == "symlink":
            actual = (destination / row["path"]).resolve(strict=True)
            need(actual == destination or destination in actual.parents, "RECEIVED_GRAPH_LINK_ESCAPES")
    save_json(inventory_file, {"schema": "starforge.retained-graph-receiving.v1",
              "source": str(source), "destination": str(destination), "counts": counts, "files": rows})
    return {**counts, "inventory": file_digest(inventory_file)}

def compose_lock(originals, package_json):
    need(all(v["lockfileVersion"] == 3 and isinstance(v.get("packages"), dict) for v in originals), "ORIGINAL_LOCK_FORMAT_CHANGED")
    primary = copy.deepcopy(originals[0]); merged = {}
    for original in originals:
        for path, value in original["packages"].items():
            if path == "": continue
            if path in merged: need(merged[path] == value, "ORIGINAL_LOCK_COMPLETE_ENTRY_COLLISION")
            else: merged[path] = copy.deepcopy(value)
    root = {key: copy.deepcopy(package_json[key]) for key in
            ("name", "version", "license", "engines", "dependencies", "optionalDependencies", "devDependencies") if key in package_json}
    need(not root.get("devDependencies") and not root.get("optionalDependencies"), "SELECTED_PROFILE_ROOT_CHANGED")
    primary.update(name=package_json["name"], version=package_json["version"], packages={"": root, **merged})
    need("dependencies" not in primary, "ORIGINAL_V3_LOCK_LEGACY_TREE_UNEXPECTED")
    return primary

class Run:
    def __init__(self, config, config_path):
        self.config = config; self.project = Path(config["project"])
        self.output = self.project / "result"; self.output.mkdir(exist_ok=True, mode=0o700)
        self.dev = Path(config["private_dev_root"]); self.config_sha = digest_bytes(Path(config_path).read_bytes())
        self.state = {"schema": "starforge.geocat-complete-package-operation.v1", "operationId": config["operation_id"],
                      "sourceCommit": config["commit"], "configSha256": self.config_sha, "startedAt": now(),
                      "phase": "STARTED", "steps": [], "sourceAcquisitions": 0, "geoNetworkRequests": 0}
        self.env = dict(os.environ); self.work = self.dev / "work"; self.logs = self.work / "logs"; self.step_index = 0

    def checkpoint(self, phase, **extra):
        self.state.update(phase=phase, updatedAt=now(), **extra)
        save_json(self.output / "state.json", self.state, replace=True)
        print(json.dumps({"operationId": self.config["operation_id"], "phase": phase}), flush=True)

    def command(self, label, args, *, cwd=None, timeout=900):
        self.step_index += 1; stem = str(self.step_index).zfill(2) + "-" + label
        stdout, stderr = self.logs / (stem + ".out"), self.logs / (stem + ".err"); start = time.monotonic()
        with stdout.open("xb") as out, stderr.open("xb") as err:
            result = subprocess.run(args, cwd=cwd or self.work, env=self.env, stdin=subprocess.DEVNULL,
                                    stdout=out, stderr=err, timeout=timeout, check=False)
        self.state["steps"].append({"name": label, "exitCode": result.returncode,
            "seconds": round(time.monotonic()-start, 3), "stdout": file_digest(stdout), "stderr": file_digest(stderr)})
        save_json(self.output / "steps.json", self.state["steps"], replace=True)
        if result.returncode:
            for source, suffix in [(stdout, "stdout"), (stderr, "stderr")]:
                size = source.stat().st_size
                with source.open("rb") as f:
                    if size > 128*1024: f.seek(size-128*1024)
                    save(self.output / (stem + "." + suffix + ".private"), f.read())
            raise RuntimeError("ORIGINAL_" + label.upper().replace("-", "_") + "_EXIT_" + str(result.returncode))
        return stdout

    def node(self, label, value, *, timeout=900):
        request, result = self.work / (label + "-input.json"), self.work / (label + "-output.json")
        save_json(request, value)
        self.command(label, [self.config["node"], self.config["runtime_bridge"], str(request), str(result)], timeout=timeout)
        body = json.loads(result.read_text()); need(body.get("status") != "failed", "ORIGINAL_NODE_RECEIVING_FAILED")
        save_json(self.output / (label + ".json"), body)
        return body

    def run(self):
        cfg = self.config
        need(self.project.resolve(strict=True) == self.project, "PERSISTENT_PROJECT_CHANGED")
        need(self.dev.parent == Path("/dev") and self.dev.name.startswith("scf-geocat-d22-33e6-"), "PRIVATE_DEV_CONTEXT_REQUIRED")
        need(self.dev.resolve(strict=True) == self.dev and not self.dev.is_symlink(), "PRIVATE_DEV_CONTEXT_CHANGED")
        need((self.dev.stat().st_mode & 0o077) == 0, "PRIVATE_DEV_MODE_REQUIRED")
        owner = json.loads((self.dev / "context.json").read_text())
        need(owner["operationId"] == cfg["operation_id"] and owner["configSha256"] == self.config_sha, "ORIGINAL_CONTEXT_BINDING_CHANGED")
        need(not self.work.exists(), "EXISTING_NATIVE_EXECUTION_REQUIRES_RECONCILIATION")
        self.work.mkdir(mode=0o700); self.logs.mkdir(mode=0o700)
        for name in ("tmp", "npm-cache"): (self.work / name).mkdir(mode=0o700)
        for name in ("TMPDIR", "TMP", "TEMP"): self.env[name] = str(self.work / "tmp")
        self.env["npm_config_cache"] = str(self.work / "npm-cache"); self.env["PYTHONDONTWRITEBYTECODE"] = "1"
        os.environ.update({k:self.env[k] for k in ("TMPDIR","TMP","TEMP","npm_config_cache","PYTHONDONTWRITEBYTECODE")})
        import tempfile
        tempfile.tempdir = str(self.work / "tmp")
        self.checkpoint("VERIFY_ORIGINAL_INPUTS")
        inputs = Path(cfg["input_root"])
        for item in cfg["fixed_inputs"]:
            need(git_blob(Path(item["path"]).read_bytes()) == item["gitBlob"], "ORIGINAL_SOURCE_INPUT_CHANGED")
        helper_dir = Path(cfg["library_helpers"])
        for name, expected in cfg["library_helper_sha256"].items():
            need(file_digest(helper_dir/name)["sha256"] == expected, "CURRENT_LIBRARY_HELPER_CHANGED")
        need(shutil.which("azcopy") is not None, "ORIGINAL_TRANSFER_EXECUTABLE_UNAVAILABLE")
        donor = Path(cfg["dependency_donor"]); donor_lock_bytes = (donor / "package-lock.json").read_bytes()
        need(digest_bytes(donor_lock_bytes) == cfg["dependency_lock_sha256"], "ORIGINAL_DEPENDENCY_LOCK_CHANGED")
        locks, lock_bytes = [json.loads(donor_lock_bytes)], [donor_lock_bytes]
        for leaf in cfg["leaf_packages"]:
            raw = leaf["originalLock"].encode()
            need(git_blob(raw) == leaf["originalLockGitBlob"], "ORIGINAL_LEAF_LOCK_CHANGED")
            value = json.loads(raw); entries = {p:v for p,v in value["packages"].items() if p}
            need(list(entries) == ["node_modules/"+leaf["name"]], "ORIGINAL_LEAF_NOT_SINGLE_PACKAGE")
            row = entries["node_modules/"+leaf["name"]]
            need(row["version"] == leaf["version"] and row["integrity"] == leaf["integrity"], "ORIGINAL_LEAF_IDENTITY_CHANGED")
            locks.append(value); lock_bytes.append(raw)
        sys.path.insert(0, cfg["native_host"])
        import node_package_cache as package_cache
        import node_lockfile_cache as lock_cache
        cached = []
        for leaf in cfg["leaf_packages"]:
            args = SimpleNamespace(cache_root=leaf["cacheRoot"], package=leaf["name"], version=leaf["version"],
                integrity=package_cache.integrity(leaf["integrity"]), destination=None, max_archive_bytes=32*1024*1024,
                max_tar_bytes=128*1024*1024, max_members=20000, scratch_root=str(self.work/"tmp"), capture_paths=False)
            report = {"outcome":"error","source":None,"archive":None,"package":None,"destination":None}
            need(package_cache.run(args, report) == 0 and report["outcome"] == "verified", "EXACT_LEAF_CACHE_UNAVAILABLE")
            cached.append(report)
        save_json(self.output/"leaf-cache-inspection.json", cached)
        self.checkpoint("ORIGINAL_SOURCE_RECEIVING")
        git_cache, source = self.work/"git-cache", self.work/"source"
        args = [cfg["python"], "-B", str(inputs/"git-object-receiving.py"), "--metadata", str(inputs/"metadata.json"),
                "--commit", cfg["commit"], "--directory", str(git_cache), "--git", cfg["git"]]
        for path in cfg["git_donors"]: args += ["--donor-repository", path]
        args += ["--donor-archive", cfg["archive_donor"]["sha256"], cfg["archive_donor"]["path"]]
        for path in cfg["incoming"]: args += ["--incoming", path]
        args += ["--materialize", str(source)]
        out = self.command("source-receiving", args)
        receiving = json.loads(out.read_text())
        need(receiving["phase"] == "OBJECTS_AVAILABLE" and receiving.get("sourceDirectory") == str(source), "COMPLETE_SOURCE_NOT_AVAILABLE")
        save_json(self.output/"source-receiving.json", receiving)
        self.checkpoint("BUILDING_ORIGINAL_SELECTION")
        built = self.node("build", {"action":"build","sourceRoot":str(source),"repository":str(git_cache/"repository.git"),
          "commit":cfg["commit"],"output":str(self.work/"release"),"python":cfg["python"]})
        need(built["status"] == "PACKAGED" and built["sourceCommit"] == cfg["commit"], "ORIGINAL_BUILD_SOURCE_CHANGED")
        archive = Path(built["archive"])
        need(archive.is_absolute() and archive.resolve(strict=True) == archive and self.work in archive.parents,
             "ORIGINAL_BUILD_ARCHIVE_PATH_CHANGED")
        archive_identity = file_digest(archive)
        need(archive_identity == {"bytes":built["archiveBytes"],"sha256":built["sha256"]}, "ORIGINAL_BUILD_ARCHIVE_CHANGED")
        with tarfile.open(archive, "r:gz") as bundle:
            item = bundle.getmember("package/manifest.json")
            need(item.isfile() and item.size <= 16*1024*1024, "ORIGINAL_MANIFEST_UNAVAILABLE")
            manifest_bytes = bundle.extractfile(item).read(); manifest = json.loads(manifest_bytes)
        need(manifest["sourceCommit"] == cfg["commit"], "ORIGINAL_MANIFEST_SOURCE_CHANGED")
        metadata = json.loads((inputs/"metadata.json").read_text()); required = set(metadata["requiredPaths"])
        expected = {r["path"]:r for r in metadata["tree"]["tree"] if r["path"] in required}
        manifest_rows = {r["path"]:r for r in manifest["files"]}
        need(set(manifest_rows) | {"LICENSE"} == set(expected), "ORIGINAL_SELECTED_CLOSURE_CHANGED")
        for path, row in manifest_rows.items():
            need(row["gitBlob"] == expected[path]["sha"] and row["bytes"] == expected[path]["size"], "ORIGINAL_SELECTED_BLOB_CHANGED")
        checkpoint = self.project/"built-source"; checkpoint.mkdir(exist_ok=True, mode=0o700)
        durable_archive = checkpoint/archive.name; copy_file(archive, durable_archive, expected=archive_identity)
        save(checkpoint/"manifest.json", manifest_bytes); save_json(checkpoint/"build-result.json", built)
        self.checkpoint("SOURCE_ARCHIVE_DURABLE", archive={"path":str(durable_archive), **archive_identity},
                        selectedSourceFiles=len(expected), selectedSourceBytes=sum(r["size"] for r in expected.values()))

        self.checkpoint("PREPARING_ORIGINAL_RUNTIME")
        installation = self.work/"installed"
        prepared = self.node("runtime-prepare", {"action":"prepare","sourceRoot":str(source),"directory":str(installation),
          "archive":str(archive),"sha256":archive_identity["sha256"],"python":cfg["python"]})
        need(prepared["status"] == "PREPARED" and prepared["sourceCommit"] == cfg["commit"], "ORIGINAL_RUNTIME_PREPARATION_CHANGED")
        pkg = json.loads((installation/"package.json").read_text()); composed = compose_lock(locks, pkg)
        original_dir = self.output/"original-locks"; original_dir.mkdir(mode=0o700)
        names = ["fe85-package-lock.json", "re2js-package-lock.json", "yaml-package-lock.json"]
        for name, raw in zip(names, lock_bytes): save(original_dir/name, raw)
        graph = copy_retained_graph(donor/"node_modules", installation/"node_modules", self.output/"dependency-files.json")
        need((donor/"package-lock.json").read_bytes() == donor_lock_bytes, "ORIGINAL_GRAPH_LOCK_CHANGED_DURING_COPY")
        leaf_results = []
        for leaf in cfg["leaf_packages"]:
            target = installation/"node_modules"/leaf["name"]; need(not os.path.lexists(target), "LEAF_COLLIDES_WITH_ORIGINAL_GRAPH")
            args = SimpleNamespace(cache_root=leaf["cacheRoot"], package=leaf["name"], version=leaf["version"],
                integrity=package_cache.integrity(leaf["integrity"]), destination=str(target), max_archive_bytes=32*1024*1024,
                max_tar_bytes=128*1024*1024, max_members=20000, scratch_root=str(self.work/"tmp"), capture_paths=False)
            report = {"outcome":"error","source":None,"archive":None,"package":None,
                      "destination":{"path":str(target),"created":False,"complete":False,"files_written":0,"bytes_written":0}}
            need(package_cache.run(args, report) == 0 and report["destination"]["complete"], "ORIGINAL_LEAF_MATERIALIZATION_FAILED")
            actual = json.loads((target/"package.json").read_text())
            bins = lock_cache.create_bins(installation/"node_modules", {"path":"node_modules/"+leaf["name"],"kind":"archive"}, actual)
            leaf_results.append({"result":report,"bins":bins})
        save_json(installation/"package-lock.json", composed)
        lock_check = self.node("runtime-lock", {"action":"validate-lock","sourceRoot":str(source),"directory":str(installation)})
        provenance = {"schema":"starforge.composed-runtime-lock.v1","kind":"COMPOSED_TARGET_LOCK","sourceCommit":cfg["commit"],
            "profileId":prepared["profileId"],"target":file_digest(installation/"package-lock.json"),
            "rootPackage":file_digest(installation/"package.json"),
            "originalLocks":[{"name":name,"sha256":digest_bytes(raw)} for name,raw in zip(names,lock_bytes)],
            "originalEntriesPreserved":sum(1 for p in locks[0]["packages"] if p),
            "addedOriginalLeafEntries":[{"name":x["name"],"version":x["version"],"gitBlob":x["originalLockGitBlob"]} for x in cfg["leaf_packages"]],
            "graph":graph,"lockValidation":{"supported":lock_check["supported"],"packageLocations":lock_check["packageLocations"]}}
        save_json(self.output/"dependency-receiving.json", {"provenance":provenance,"leafResults":leaf_results})
        ready = self.node("runtime-adopt", {"action":"adopt","sourceRoot":str(source),"directory":str(installation)})
        need(ready["status"] == "READY" and ready["ready"] and ready["adoptedRetainedDependencies"], "ORIGINAL_RUNTIME_NOT_READY")
        checked = self.node("runtime-inspect", {"action":"inspect","sourceRoot":str(source),"directory":str(installation),"python":cfg["python"]})
        need(checked["status"] == "READY" and checked["ready"] and checked["sourceVerified"], "FRESH_ORIGINAL_RUNTIME_INSPECTION_FAILED")
        self.checkpoint("INSTALLED_APPLICATION_RECEIVING")
        app = self.node("application", {"action":"application","sourceRoot":str(source),"installedSourceRoot":prepared["sourceRoot"],
            "directory":str(installation),"customerDirectory":str(self.work/"customer"),"commit":cfg["commit"],
            "playwrightModule":cfg["playwright_module"],"chromiumExecutable":cfg.get("chromium_executable")}, timeout=240)
        need(app["status"] == "COMPLETED" and app["sourceAcquisitions"] == 0 and app["geoNetworkRequests"] == 0,
             "INSTALLED_APPLICATION_RECEIVING_INCOMPLETE")

        self.checkpoint("PACKAGING_CUSTOMER_HANDOVER")
        package = self.work/"customer-package"; package.mkdir(mode=0o700)
        copy_file(archive, package/archive.name, expected=archive_identity)
        save(package/"source-manifest.json", manifest_bytes)
        save_json(package/"build-result.json", {k:built[k] for k in
            ("status","packageName","packageVersion","sourceCommit","sourceSelection","sha256","integrity",
             "archiveBytes","installedBytes","sourceFiles","sourceBytes") if k in built})
        runtime_inputs = package/"runtime-inputs"; runtime_inputs.mkdir(mode=0o700)
        for name in ("package.json","package-lock.json","runtime-profile.json"):
            copy_file(installation/name,runtime_inputs/name)
        save_json(runtime_inputs/"pins.json", {"@stellar/stellar-sdk":"16.3.1"})
        save_json(runtime_inputs/"lock-provenance.json", provenance)
        for name,raw in zip(names,lock_bytes): save(runtime_inputs/"original-locks"/name,raw)
        documents = package/"customer"; documents.mkdir(mode=0o700)
        for name in ("GeoCat_Catalogue_Workshare.md","GeoCat_Catalogue_Intake.json"):
            copy_file(inputs/"customer"/name,documents/name)
        save_json(package/"installed-application-result.json", app)
        guide = (
            "# GeoCat catalogue receiving\n\nSource: " + cfg["commit"] + "\n\n"
            "This package contains the complete maintained geocat-catalogue source distribution, "
            "its exact runtime profile and composed target lock, the customer workshare/intake, "
            "and the actual installed application receiving result. All original lock entries "
            "retain their resolved URLs, integrity values, optional/platform flags and layout. "
            "The target root comes from the source-selected runtime package.json. "
            "Normal installation obtains the selected dependency archives from npm or an existing cache.\n\n"
            "## Install\n\nUse Linux, Node 22.16+, Python 3.11+, npm and flock. "
            "Extract the original source TGZ into a new directory. Its "
            "package/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs "
            "is the maintained installer. PATH_TO below refers to that distribution directory.\n\n"
            "    node PATH_TO/runtime-install-cli.mjs prepare --dir NEW_RUNTIME --archive " + archive.name +
            " --sha256 " + archive_identity["sha256"] +
            " --native --feature schema --feature openapi --feature mcp --operator --pins runtime-inputs/pins.json\n"
            "    cp runtime-inputs/package-lock.json NEW_RUNTIME/package-lock.json\n"
            "    node PATH_TO/runtime-install-cli.mjs install --dir NEW_RUNTIME\n"
            "    node PATH_TO/runtime-install-cli.mjs inspect --dir NEW_RUNTIME --load --source\n"
            "    node PATH_TO/runtime-install-cli.mjs run --dir NEW_RUNTIME -- stac init --workspace NEW_STAC --title 'Catalogue receiving'\n"
            "    node PATH_TO/runtime-install-cli.mjs run --dir NEW_RUNTIME -- stac serve --workspace NEW_STAC --catalogue-workspace NEW_CATALOGUE --port 0 --startup-json\n\n"
            "Choose absolute private workspace paths. Preserve the printed private session URL. "
            "Open Catalogue receiving in the same STAC application. Use the complete operating guide "
            "inside source/stellar/scf-starforge-20261009/distribution/selections/GEOCAT_CATALOGUE.md "
            "and the native contract beside stac/geonetwork/native.mjs.\n\n"
            "## Native catalogue work\n\n"
            "Select the existing GeoNetwork installation, credential environment variable names, "
            "and original completed StacDelivery. Review the complete source and native harvest plan, "
            "then keep original operation IDs for continuation. The separate existing native customer "
            "request is SCF-GEOCAT-NATIVE-CUSTOMER-20261012-33E6. Its GeoNetwork outcome is separate "
            "from the installation and same-app receiving result in this package.\n\n"
            "The original application supplies full handover export and receiving for actual selected "
            "customer state. This source package contains public source, customer documents, exact "
            "runtime inputs, and the installed application result.\n"
        )
        save(package/"START_HERE.md",guide.encode())
        members = []
        for path in sorted(package.rglob("*")):
            if path.is_dir(): continue
            need(path.is_file() and not path.is_symlink(), "CUSTOMER_PACKAGE_REGULAR_MEMBERS_REQUIRED")
            members.append({"path":path.relative_to(package).as_posix(), **file_digest(path)})
        package_manifest = {"schema":"starforge.geocat-customer-package.v1","sourceCommit":cfg["commit"],
                    "operationId":cfg["operation_id"],"createdAt":now(),"files":members,
                    "sourceArchive":{"name":archive.name,**archive_identity},
                    "completeSelectedSourceFiles":len(expected),
                    "nativeCatalogueCustomerOperation":"SCF-GEOCAT-NATIVE-CUSTOMER-20261012-33E6"}
        save_json(package/"PACKAGE_MANIFEST.json",package_manifest)
        final = self.work/"GeoCat_Catalogue_Application_d22dfce8.zip"
        with zipfile.ZipFile(final,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as bundle:
            for path in sorted(package.rglob("*")):
                if path.is_file(): bundle.write(path,path.relative_to(package).as_posix())
        identity = file_digest(final)
        with zipfile.ZipFile(final) as bundle:
            need(bundle.testzip() is None and len(bundle.infolist()) == len(members)+1, "CUSTOMER_ZIP_READBACK_FAILED")
        save_json(self.output/"package-manifest.json",package_manifest)
        final_persistent = self.project/final.name
        copy_file(final,final_persistent,expected=identity)
        self.checkpoint("CUSTOMER_PACKAGE_DURABLE", package={"path":str(final_persistent),**identity})
        # One ordinary full save before this /dev context ends. An unknown result is never replayed here.
        sys.path.insert(0,str(helper_dir))
        from library_upload import LibraryUploadWorkflow, HostedAppsClient, LibraryFileMaterializer, SignedUrlUploader
        state_parent = self.work/"library-state"; state_parent.mkdir(mode=0o700)
        request = {"uploads":[{"local_path":str(final),"purpose":"create_library_file","library_artifact_type":"other"}]}
        save_json(self.output/"upload-dispatch.json", {"operationId":cfg["operation_id"],"status":"DISPATCHING",
                  "package":identity,"at":now()})
        self.checkpoint("SAVING_FINAL_PACKAGE")
        result = LibraryUploadWorkflow(apps_client=HostedAppsClient(),materializer=LibraryFileMaterializer(),
            uploader=SignedUrlUploader(),state_parent=state_parent).run(request)
        save_json(self.output/"upload-result.private.json",result)
        rows = result.get("results",[])
        need(len(rows)==1 and rows[0].get("status")=="succeeded","FINAL_PACKAGE_SAVE_NOT_SUCCEEDED")
        selected = rows[0]
        saved = {k:selected[k] for k in ("status","file_id","library_file_id","file_name",
                 "current_version_number","local_metadata_applied") if k in selected}
        try:
            for name in os.listxattr(final): os.setxattr(final_persistent,name,os.getxattr(final,name))
        except OSError: pass
        completion = {**self.state,"phase":"COMPLETED","completedAt":now(),"package":{**identity,
              "path":str(final_persistent),"name":final.name},"savedFile":saved,
              "sourceArchive":{"path":str(durable_archive),**archive_identity},"installedApplication":app,
              "lockProvenance":provenance,"packageManifest":file_digest(self.output/"package-manifest.json")}
        save_json(self.output/"result.json",completion)
        self.checkpoint("COMPLETED",package=completion["package"],savedFile=saved)
        print(json.dumps({"status":"COMPLETED","package":completion["package"],"savedFile":saved}),flush=True)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--config",required=True); args=parser.parse_args()
    config_path=Path(args.config).resolve(strict=True); config=json.loads(config_path.read_text())
    project=Path(config["project"]); project.mkdir(exist_ok=True,mode=0o700)
    lock=open(project/"driver.lock","a+b")
    try: fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: raise RuntimeError("ORIGINAL_DRIVER_ALREADY_OWNED")
    need(not (project/"result"/"state.json").exists(),"ORIGINAL_DISPATCH_ALREADY_RECORDED")
    run=Run(config,config_path)
    try: run.run()
    except BaseException as error:
        failure={"phase":"FAILED","at":now(),"type":type(error).__name__,"code":str(error)[:1600],
                 "operationId":config["operation_id"],"sourceCommit":config["commit"]}
        save_json(run.output/"failure.private.json",failure)
        run.checkpoint("FAILED",failure={"type":failure["type"],"code":failure["code"]})
        print(json.dumps({"status":"FAILED","operationId":config["operation_id"],
                         "type":failure["type"],"code":failure["code"]}),flush=True)
        raise
    finally:
        fcntl.flock(lock.fileno(),fcntl.LOCK_UN); lock.close()

if __name__=="__main__":
    main()

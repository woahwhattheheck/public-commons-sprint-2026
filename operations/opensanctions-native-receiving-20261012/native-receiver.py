"""Continue the retained OpenSanctions project through original yente/OpenSearch.
Native operation entrypoint for the retained project and published engines.
Run through the existing Commons ForegroundLaunch on its selected worker.
The portable receiving wrapper supplies the exact merged source directory.
"""
from __future__ import annotations
import argparse, contextlib, hashlib, io, json, os, pathlib, pwd, re, shutil
import signal, socket, subprocess, sys, tarfile, tempfile, time, traceback, urllib.request, urllib.error

YENTE_VERSION = "5.5.0"
YENTE_SOURCE = "258c0a1fbcd9e7f70acdb113f19c28b7eac282b8"
YENTE_WHEEL_SHA256 = "97d7a09af6ff919b76334e6784537d1ce24ec288c5436a2f19db99772f846401"
SEARCH_URL = "https://artifacts.opensearch.org/releases/core/opensearch/2.15.0/opensearch-min-2.15.0-linux-x64.tar.gz"
SEARCH_BYTES = 252915665
SEARCH_SHA512 = "efd2a88766e8a2f5a7e0f73cc61fa45fa07edbe8c36ce7708bba4f80b64bf4b627bb9a46f26bd6e70279610ef1fd416b00d9a34387198ea3c7eb4d2e388356aa"
INITIAL_PACKET_SHA256 = "2773214cb71964dfd0059b144164df276a138a9c43a1d81b75766ee0c048097f"
AFTER_ID = "668909e926190d0fc38b8f81ee184333cc063d71244c41551046740fc0fcfb18"
AFTER_VERSION = "20261012000104-kls"
CASE_ID = "64e5904305d833550e4fcc96ae941879ca028fd07c4740ad9075fc3ef36837fb"
PORTFOLIO_ID = "346dca20eb08f2a7e7b16b1f43c6e52f7db1b360a5d017bc53f171888a0e6a65"
QUERIES = ["NK-imakgBoSw66P4ytCKUaNZ2", "Q108304787"]
OPERATION = "DCE4-OPENSANCTIONS-NATIVE-20261012"
p = argparse.ArgumentParser()
p.add_argument("--directory", required=True)
p.add_argument("--source", required=True)
p.add_argument("--application-directory", help="Actual original monitoring module directory; defaults to the retained capsule layout")
p.add_argument("--search-archive", help="Existing exact publisher OpenSearch core TAR")
p.add_argument("--input", required=True)
p.add_argument("--node", required=True)
p.add_argument("--search-user")
p.add_argument("--search-home")
p.add_argument("--yente-bin")
p.add_argument("--allow-private-development-packages", action="store_true")
args = p.parse_args()
ROOT = pathlib.Path(args.directory).resolve()
SOURCE = pathlib.Path(args.source).resolve()
OUTPUT = ROOT / "results"
RUNTIME = ROOT / "runtime"
for d in (ROOT, OUTPUT, RUNTIME, ROOT / "tmp"):
    d.mkdir(mode=0o700, parents=True, exist_ok=True)
os.umask(0o077)
os.environ["TMPDIR"] = str(ROOT / "tmp")
os.environ["SF30_XML_NODE"] = str(pathlib.Path(args.node).resolve())
APPLICATION = pathlib.Path(args.application_directory).resolve(strict=True) if args.application_directory else SOURCE / "application" / "opensanctions"
if not APPLICATION.is_dir() or not (APPLICATION / "model.py").is_file():
    raise RuntimeError("Select the original monitoring application directory")
sys.path.insert(0, str(APPLICATION))
from model import Workspace, json_bytes
import matching

RESULT = OUTPUT / "run-result.json"
report = json.loads(RESULT.read_text()) if RESULT.exists() else {
    "schema": "starforge.opensanctions.native-receiving.v1", "operation": OPERATION,
    "startedAt": time.time(), "inputSha256": INITIAL_PACKET_SHA256,
    "steps": [], "results": {}, "status": "PREPARING",
    "engines": {"yente": {"version": YENTE_VERSION, "source": YENTE_SOURCE,
                         "wheelSha256": YENTE_WHEEL_SHA256},
                "opensearch": {"version": "2.15.0", "url": SEARCH_URL,
                               "bytes": SEARCH_BYTES, "sha512": SEARCH_SHA512}},
}
children = []
handles = []
ws = None
selected_yente_wheel = None

def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with pathlib.Path(path).open("rb") as stream:
        while block := stream.read(1024 * 1024):
            h.update(block)
    return h.hexdigest()

def write_json(path, body):
    path = pathlib.Path(path)
    tmp = path.with_name(path.name + ".pending")
    with tmp.open("wb") as out:
        out.write(json_bytes(body)); out.flush(); os.fsync(out.fileno())
    os.replace(tmp, path)

def record(name, result, summary=None):
    report["results"][name] = result
    report["steps"].append({"name": name, "at": time.time(), "summary": summary or result})
    write_json(RESULT, report)
    print(json.dumps({"step": name, "summary": summary or result}, ensure_ascii=False), flush=True)

def run(name, argv, *, environment=None, timeout=600, cwd=None):
    log = OUTPUT / (name + ".log")
    with log.open("ab") as out:
        child = subprocess.Popen(argv, cwd=cwd or ROOT, env=environment,
                                 stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        children.append(child)
        try:
            code = child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            stop(child)
            raise RuntimeError(name + " exceeded its selected execution time; original log retained")
    result = {"argv": argv, "exitCode": code, "log": log.name, "sha256": digest(log)}
    record(name, result)
    if code:
        raise RuntimeError(name + " exited " + str(code) + "; read the retained original log")
    return result

def stop(child):
    if child.poll() is None:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signal.SIGTERM)
        try: child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=10)

def background(name, argv, *, environment=None, cwd=None):
    log = OUTPUT / (name + ".log")
    out = log.open("ab"); handles.append(out)
    child = subprocess.Popen(argv, cwd=cwd or ROOT, env=environment,
                             stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
    children.append(child)
    record(name + "_started", {"pid": child.pid, "argv": argv, "log": log.name})
    return child

def get(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": "Starforge original source receiving/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(4 * 1024 * 1024 + 1)
            if len(body) > 4 * 1024 * 1024: raise RuntimeError("Metadata response is unexpectedly large")
            return response.status, dict(response.headers), body
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read(1024 * 1024)

def download(url, destination, expected, *, algorithm="sha256", expected_bytes=None):
    destination = pathlib.Path(destination)
    if destination.exists():
        if digest(destination, algorithm) != expected or expected_bytes is not None and destination.stat().st_size != expected_bytes:
            raise RuntimeError("Existing original dependency differs: " + destination.name)
        return destination
    staged = destination.with_name(destination.name + ".part")
    h = hashlib.new(algorithm); count = 0
    req = urllib.request.Request(url, headers={"User-Agent": "Starforge original source receiving/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response, staged.open("wb") as out:
        if response.status != 200: raise RuntimeError("Original dependency HTTP " + str(response.status))
        while block := response.read(256 * 1024):
            count += len(block); h.update(block); out.write(block)
        out.flush(); os.fsync(out.fileno())
    if h.hexdigest() != expected or expected_bytes is not None and count != expected_bytes:
        raise RuntimeError("Original dependency size or digest differs: " + destination.name)
    os.replace(staged, destination)
    record("download_" + destination.name, {"url": url, "file": str(destination), "bytes": count,
                                          algorithm: h.hexdigest()})
    return destination

def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def poll_ready(name, base, child, path, timeout=150):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError(name + " closed before readiness with exit " + str(child.returncode))
        try:
            code, headers, body = get(base + path, 5)
            last = {"status": code, "headers": headers, "body": body.decode("utf-8", "replace")}
            if 200 <= code < 300:
                record(name + "_ready", last, {"status": code, "path": path})
                return last
        except (OSError, urllib.error.URLError) as error:
            last = {"error": str(error)}
        time.sleep(1)
    record(name + "_readiness_outcome", last)
    raise RuntimeError(name + " did not reach its original readiness endpoint")

def capture(name, argv, *, environment=None, timeout=120):
    run(name, [str(value) for value in argv], environment=environment, timeout=timeout)
    return (OUTPUT / (name + ".log")).read_text(errors="replace")

def private_development_packages(names):
    """Use the retained Commons private APT download/extract transport.

    The selected packages retain their signed repository index and full archive
    digests. Package scripts and system service configuration are not executed.
    """
    if not args.allow_private_development_packages:
        raise RuntimeError("Select the private development package inputs on this worker: " + ", ".join(names))
    for command in ("apt-get", "apt-cache", "dpkg-deb"):
        if not shutil.which(command):
            raise RuntimeError("The selected private package transport requires installed " + command)
    apt = RUNTIME / "private-apt"
    package_root = RUNTIME / "development-packages"
    complete = apt / "complete.json"
    if complete.exists():
        saved = json.loads(complete.read_text())
        if saved["requested"] != names:
            raise RuntimeError("The same retained development package selection changed")
        for row in saved["archives"]:
            if digest(row["archive"]) != row["sha256"]:
                raise RuntimeError("A retained original development package changed")
        return pathlib.Path(saved["root"])
    for path in ("state/lists/partial", "archives/partial", "cache", "logs"):
        (apt / path).mkdir(parents=True, mode=0o700, exist_ok=True)
    status = apt / "status"
    if not status.exists():
        shutil.copyfile("/var/lib/dpkg/status", status)
    options = ["-o", "Dir::State=" + str(apt / "state"),
               "-o", "Dir::State::status=" + str(status),
               "-o", "Dir::Cache=" + str(apt / "cache"),
               "-o", "Dir::Cache::archives=" + str(apt / "archives"),
               "-o", "Dir::Log=" + str(apt / "logs"),
               "-o", "APT::Sandbox::User=" + pwd.getpwuid(os.getuid()).pw_name]
    plan_path = apt / "plan.json"
    if plan_path.exists():
        plan = json.loads(plan_path.read_text())
        if plan["requested"] != names:
            raise RuntimeError("The original signed package plan differs")
    else:
        run("private_apt_index", ["apt-get", *options, "update"], timeout=240)
        selected = {}
        for name in names:
            policy = capture("private_apt_policy_" + name, ["apt-cache", *options, "policy", name])
            candidate = re.search(r"^\s*Candidate:\s*(\S+)", policy, re.M)
            if not candidate or candidate.group(1) == "(none)":
                raise RuntimeError("No signed development package candidate for " + name)
            selected[name] = candidate.group(1)
        if "libicu-dev" in selected:
            metadata = capture("private_icu_dependencies", ["apt-cache", *options, "show",
                               "libicu-dev=" + selected["libicu-dev"]])
            # Receive the exact ICU runtime matching these development headers,
            # even when the host status would otherwise satisfy a dependency.
            peers = re.findall(r"\b(libicu\d+)\s*\(=\s*([^)]+)\)", metadata)
            if not peers:
                raise RuntimeError("The selected ICU headers did not declare their matching runtime")
            for name, version in peers:
                if name in selected and selected[name] != version:
                    raise RuntimeError("The selected original ICU runtime is ambiguous")
                selected[name] = version.strip()
        plan = {"schema": "starforge.private-development-packages.v1", "operation": OPERATION,
                "requested": names, "selected": [{"name": name, "version": version}
                    for name, version in sorted(selected.items())],
                "dpkgStatusSha256": digest(status),
                "index": [{"file": str(path), "sha256": digest(path)}
                    for path in sorted((apt / "state/lists").iterdir()) if path.is_file()]}
        write_json(plan_path, plan)
    exact = [row["name"] + "=" + row["version"] for row in plan["selected"]]
    run("private_apt_download", ["apt-get", *options, "--yes", "--download-only", "--reinstall",
                                 "--no-install-recommends", "install", *exact], timeout=480)
    package_root.mkdir(mode=0o700, exist_ok=True)
    archives = []
    for archive in sorted((apt / "archives").glob("*.deb")):
        fields = capture("private_package_identity_" + archive.name,
                         ["dpkg-deb", "-f", str(archive), "Package", "Version", "Architecture"])
        declared = dict(line.split(": ", 1) for line in fields.splitlines() if ": " in line)
        name, version = declared.get("Package"), declared.get("Version")
        if not name or not version:
            raise RuntimeError("Original package identity is unavailable")
        metadata = capture("private_package_source_" + name,
                           ["apt-cache", *options, "show", name + "=" + version])
        hashes = set(re.findall(r"^SHA256:\s*([0-9a-f]{64})$", metadata, re.M))
        actual = digest(archive)
        if actual not in hashes:
            raise RuntimeError("Original package differs from its signed source metadata: " + name)
        run("private_package_extract_" + name, ["dpkg-deb", "--extract", str(archive), str(package_root)])
        archives.append({"name": name, "version": version, "architecture": declared.get("Architecture"),
                         "bytes": archive.stat().st_size, "sha256": actual, "archive": str(archive)})
    receipt = {**plan, "root": str(package_root), "archives": archives}
    write_json(complete, receipt)
    write_json(OUTPUT / "private-development-packages.json", receipt)
    record("private_development_packages", receipt, {"packages": len(archives), "root": str(package_root)})
    return package_root

def original_yente_wheel():
    code, _, raw = get("https://pypi.org/pypi/yente/5.5.0/json")
    if code != 200:
        raise RuntimeError("Original PyPI release metadata returned HTTP " + str(code))
    data = json.loads(raw)
    wheels = [row for row in data["urls"] if row["packagetype"] == "bdist_wheel"
              and row["digests"]["sha256"] == YENTE_WHEEL_SHA256]
    if len(wheels) != 1:
        raise RuntimeError("The selected original yente wheel is absent from published metadata")
    write_json(OUTPUT / "yente-release-metadata.json", data)
    return download(wheels[0]["url"], RUNTIME / wheels[0]["filename"], YENTE_WHEEL_SHA256)

def provision_yente():
    global selected_yente_wheel
    selected_yente_wheel = original_yente_wheel()
    if args.yente_bin:
        return pathlib.Path(args.yente_bin).resolve()
    if not (3, 11) <= sys.version_info[:2] <= (3, 14):
        raise RuntimeError("The original yente release requires Python 3.11 through 3.14")
    venv = RUNTIME / "yente-venv"
    if not (venv / "bin/python").exists():
        run("python_environment", [sys.executable, "-m", "venv", str(venv)], timeout=120)
    py = str(venv / "bin/python")
    import sysconfig
    python_include = pathlib.Path(sysconfig.get_path("include"))
    header_root = pathlib.Path("/usr/include")
    libdirs = [pathlib.Path(p) for p in ("/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib")]
    libraries = lambda path: all((path / ("lib" + stem + ".so")).exists()
                                for stem in ("icuuc", "icui18n", "icudata"))
    libdir = next((path for path in libdirs if libraries(path)), None)
    packages = []
    if not (header_root / "unicode/uvernum.h").exists() or libdir is None:
        packages.append("libicu-dev")
    if not (python_include / "Python.h").exists():
        packages.append("python" + str(sys.version_info.major) + "." + str(sys.version_info.minor) + "-dev")
    if not shutil.which("g++"):
        packages.append("g++")
    private_root = private_development_packages(packages) if packages else None
    if private_root and "libicu-dev" in packages:
        header_root = private_root / "usr/include"
        libdir = next((private_root / str(path).lstrip("/") for path in libdirs
                       if libraries(private_root / str(path).lstrip("/"))), None)
    if libdir is None:
        raise RuntimeError("The selected original ICU development linker files are missing")
    if not (python_include / "Python.h").exists() and private_root:
        python_include = private_root / ("usr/include/python" + str(sys.version_info.major) + "." + str(sys.version_info.minor))
    if not (python_include / "Python.h").exists():
        raise RuntimeError("Matching native Python development headers are missing")
    uv = header_root / "unicode/uvernum.h"
    if not uv.exists():
        raise RuntimeError("The selected original ICU version header is missing")
    version_match = re.search(r'#define\s+U_ICU_VERSION\s+"([^"]+)"', uv.read_text())
    if not version_match:
        raise RuntimeError("The actual selected ICU version was not found")
    icu = version_match.group(1)
    env = dict(os.environ)
    env.update({"PIP_INDEX_URL": "https://pypi.org/simple", "PIP_NO_CACHE_DIR": "1",
                "PIP_DISABLE_PIP_VERSION_CHECK": "1", "PIP_REQUIRE_VIRTUALENV": "true",
                "ICU_VERSION": icu, "PYICU_INCLUDES": str(header_root),
                "PYICU_CFLAGS": "-std=c++17",
                "PYICU_LFLAGS": "-L" + str(libdir) + ":-Wl,-rpath," + str(libdir),
                "PYICU_LIBRARIES": "icui18n:icuuc:icudata",
                "CFLAGS": "-I" + str(python_include),
                "MAKEFLAGS": "-j1", "MAX_JOBS": "1", "CMAKE_BUILD_PARALLEL_LEVEL": "1"})
    if private_root and "g++" in packages:
        compiler = private_root / "usr/bin/g++"
        if not compiler.exists():
            raise RuntimeError("The selected private C++ compiler did not provide its original executable")
        env["CXX"] = str(compiler)
        env["PATH"] = str(private_root / "usr/bin") + os.pathsep + env.get("PATH", "")
        env["CPATH"] = os.pathsep.join(str(path) for path in
             (private_root / "usr/include", private_root / "usr/include/x86_64-linux-gnu") if path.is_dir())
    wheel = selected_yente_wheel
    pyicu = download("https://files.pythonhosted.org/packages/b7/d5/354eb1bf84dcf4ab0bfa46f0620ecf68fe313bb082c26872ceb7a5021f94/pyicu-2.16.2.tar.gz",
                     RUNTIME / "pyicu-2.16.2.tar.gz",
                     "006d51e24b5ec76df6ec2130f3dde269c51db8b8cfebb7d45a427dde0d10aa52", expected_bytes=268223)
    run("yente_install", [py, "-m", "pip", "install", "--index-url", "https://pypi.org/simple",
                         "--report", str(OUTPUT / "yente-installed-distributions.json"), str(pyicu), str(wheel)],
        environment=env, timeout=1200)
    record("icu_runtime", {"version": icu, "includes": str(header_root), "libraryDirectory": str(libdir),
                           "pythonIncludes": str(python_include), "private": bool(private_root)})
    return venv / "bin/yente"

def provision_search(account):
    # Only this operation's mutable installation is configured. Its original
    # archive and selected publisher digest remain in the private runtime.
    home = (pathlib.Path("/tmp") / ("dce4-opensanctions-" + hashlib.sha256(OPERATION.encode()).hexdigest()[:20])
            if account else RUNTIME / "opensearch-2.15.0")
    marker = home / ".starforge-original-distribution.json"
    expected = {"operation": OPERATION, "version": "2.15.0", "sha512": SEARCH_SHA512}
    if marker.exists():
        if json.loads(marker.read_text()) != expected:
            raise RuntimeError("The retained original search distribution changed")
        return home
    if home.exists():
        raise RuntimeError("An incomplete original search installation requires its recorded setup reconciliation")
    stage = pathlib.Path(tempfile.mkdtemp(prefix="dce4-original-search-", dir=home.parent))
    try:
        selected = stage / "opensearch-2.15.0"
        if args.search_home:
            donor = pathlib.Path(args.search_home).resolve()
            if not (donor / "bin/opensearch").is_file():
                raise RuntimeError("The selected original OpenSearch installation is missing")
            shutil.copytree(donor, selected, symlinks=True,
                ignore=lambda base, names: set(names) & {"data", "logs", "tmp"} if pathlib.Path(base) == donor else set())
        else:
            if args.search_archive:
                archive = pathlib.Path(args.search_archive).resolve(strict=True)
                if archive.stat().st_size != SEARCH_BYTES or digest(archive, "sha512") != SEARCH_SHA512:
                    raise RuntimeError("The selected cached original OpenSearch TAR differs")
                record("selected_search_archive", {"path": str(archive), "bytes": SEARCH_BYTES,
                       "sha512": SEARCH_SHA512})
            else:
                archive = download(SEARCH_URL, RUNTIME / "opensearch-min-2.15.0-linux-x64.tar.gz",
                                   SEARCH_SHA512, algorithm="sha512", expected_bytes=SEARCH_BYTES)
            with tarfile.open(archive, "r:gz") as source:
                for member in source.getmembers():
                    path = pathlib.PurePosixPath(member.name)
                    if path.is_absolute() or ".." in path.parts or path.parts[0] != "opensearch-2.15.0":
                        raise RuntimeError("Original archive has an unexpected member path")
                source.extractall(stage, filter="data")
        write_json(selected / ".starforge-original-distribution.json", expected)
        os.replace(selected, home)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    record("search_distribution", {"path": str(home), "sha512": SEARCH_SHA512,
                                  "artifactBytes": SEARCH_BYTES, "selectedInstalledSource": args.search_home})
    return home

def retain_response(name, url, domain):
    status, headers, body = get(url)
    original = domain.put_object(io.BytesIO(body), name + ".json", headers.get("Content-Type", "application/json"),
                                 {"url": url, "status": status, "headers": headers})
    write_json(OUTPUT / (name + "-http.json"), {"url": url, "status": status,
               "headers": headers, "object": original["id"], "sha256": hashlib.sha256(body).hexdigest()})
    (OUTPUT / (name + ".json")).write_bytes(body)
    if status != 200: raise RuntimeError(name + " returned HTTP " + str(status))
    return json.loads(body)

def runtime_owner():
    if os.geteuid() != 0:
        return None
    if not args.search_user:
        raise RuntimeError("Select the existing nonroot worker account for the original OpenSearch process")
    account = pwd.getpwnam(args.search_user)
    if account.pw_uid == 0: raise RuntimeError("The selected search account must be nonroot")
    if not shutil.which("runuser"): raise RuntimeError("The worker does not have its native runuser launcher")
    return account

def relocate_search(home, account):
    if account is None:
        return home
    # The installation was already received under this operation's own
    # traversable /tmp path. Preserve /root and every donor installation.
    for base, dirs, files in os.walk(home):
        os.chown(base, account.pw_uid, account.pw_gid)
        for name in dirs + files:
            os.lchown(pathlib.Path(base) / name, account.pw_uid, account.pw_gid)
    return home

def interrupted(signum, frame):
    report["status"] = "NATIVE_RECEIVING_INTERRUPTED"
    report["interrupted"] = {"signal": signum, "at": time.time()}
    raise SystemExit(128 + signum)

signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)

try:
    if report.get("status") == "NATIVE_RECEIVING_COMPLETE":
        print(json.dumps({"status": report["status"], "results": str(RESULT), "existing": True}), flush=True)
        sys.exit(0)
    report["status"] = "PREPARING"
    original = pathlib.Path(args.input)
    if digest(original) != INITIAL_PACKET_SHA256:
        raise RuntimeError("The original source receiving packet changed")
    account = runtime_owner()
    record("selected_worker", {"uid": os.getuid(), "gid": os.getgid(),
           "searchUser": account.pw_name if account else pwd.getpwuid(os.geteuid()).pw_name,
           "node": args.node, "python": sys.version, "directory": str(ROOT)})
    yente = provision_yente()
    home = relocate_search(provision_search(account), account)
    java = home / "jdk/bin/java"
    if not java.exists():
        located = shutil.which("java")
        if not located: raise RuntimeError("No original bundled or supported installed Java is available")
        java = pathlib.Path(located).resolve()
    run("java_version", [str(java), "-version"], timeout=20)
    env = dict(os.environ)
    env.pop("OPENSEARCH_JAVA_OPTS", None)
    env["OPENSEARCH_JAVA_HOME"] = str(java.parent.parent)
    env["OPENSEARCH_PATH_CONF"] = str(home / "config")
    env["OPENSEARCH_TMPDIR"] = str(home / "tmp")
    ports = report["results"].get("native_ports")
    if ports is None:
        ports = {"search": free_port(), "transport": free_port(), "yente": free_port()}
        record("native_ports", ports)
    search_port, transport_port, yente_port = ports["search"], ports["transport"], ports["yente"]
    for name in ("data", "logs", "tmp"):
        (home / name).mkdir(mode=0o700, exist_ok=True)
    (home / "config/opensearch.yml").write_text(
        "cluster.name: dce4-opensanctions-native\nnode.name: original-source-receiver\n"
        "network.host: 127.0.0.1\nhttp.port: " + str(search_port) + "\ntransport.port: " + str(transport_port) +
        "\ndiscovery.type: single-node\npath.data: " + str(home / "data") + "\npath.logs: " + str(home / "logs") + "\n")
    options = home / "config/jvm.options"
    lines = options.read_text().splitlines()
    lines = [line for line in lines if not re.match(r"^-Xms|^-Xmx|^-XX:MaxMetaspaceSize=|^-XX:CompressedClassSpaceSize=", line)]
    options.write_text("\n".join(lines + ["-Xms512m", "-Xmx512m", "-XX:MaxMetaspaceSize=256m",
                                        "-XX:CompressedClassSpaceSize=64m", ""]))
    if account:
        for item in (home / "config/opensearch.yml", options, home / "data", home / "logs", home / "tmp"):
            os.chown(item, account.pw_uid, account.pw_gid)
    search_argv = [str(home / "bin/opensearch")]
    if account: search_argv = ["runuser", "-u", account.pw_name, "--", *search_argv]
    search = background("opensearch", search_argv, environment=env, cwd=home)
    search_url = "http://127.0.0.1:" + str(search_port)
    poll_ready("opensearch", search_url, search, "/")
    version = json.loads(get(search_url)[2])
    if version.get("version", {}).get("number") != "2.15.0":
        raise RuntimeError("The original selected search engine version changed")
    record("opensearch_version", version)
    ws = Workspace(ROOT / "workspace", create=not (ROOT / "workspace").exists())
    domain = ws.opensanctions
    if not domain.state()["editions"]:
        record("original_receiving", domain.import_packet(original))
    current = domain.case_history(CASE_ID)
    if len(current["history"]) != 2 or current["case"]["candidateId"] != "Q94511220":
        raise RuntimeError("The received original case history differs")
    after = domain._one("editions", AFTER_ID)
    if after["version"] != AFTER_VERSION or after["statistics"]["records"] != 2923:
        raise RuntimeError("The selected original data edition differs")
    ftm = domain._source_path(after["source"])
    manifest = {"catalogs": [], "datasets": [{"name": "un_sc_sanctions",
                "title": "United Nations Security Council Consolidated Sanctions",
                "path": str(ftm), "version": AFTER_VERSION, "namespace": False, "load": True}]}
    # JSON is a YAML subset consumed by the original manifest loader.
    manifest_path = RUNTIME / "selected-manifest.json"
    write_json(manifest_path, manifest)
    native_env = dict(os.environ)
    native_env.update({"YENTE_MANIFEST": str(manifest_path), "YENTE_INDEX_TYPE": "opensearch",
                      "YENTE_INDEX_URL": search_url, "YENTE_INDEX_NAME": "dce4-opensanctions-native",
                      "YENTE_HOST": "127.0.0.1", "YENTE_PORT": str(yente_port),
                      "YENTE_AUTO_REINDEX": "false", "YENTE_DATA_PATH": str(ROOT / "tmp"),
                      "YENTE_VERIFY_CHECKSUM": "true", "YENTE_INDEX_AUTO_REPLICAS": "0",
                      "YENTE_LOG_JSON": "true"})
    native_python = yente.parent / "python"
    version_source = """
import hashlib, importlib.metadata as m, json, pathlib, sys, zipfile
import yente
from yente import settings
from yente.search.versions import get_system_version, build_index_name
expected = {'yente':'5.5.0','followthemoney':'4.9.2','nomenklatura':'4.10.0','rigour':'2.1.2','PyICU':'2.16.2'}
versions = {name:m.version(name) for name in expected}
if versions != expected or settings.INDEX_VERSION != '016':
    raise RuntimeError('Selected installed engine dependency versions differ: ' + repr(versions))
wheel = pathlib.Path(sys.argv[1])
if hashlib.sha256(wheel.read_bytes()).hexdigest() != sys.argv[2]:
    raise RuntimeError('Selected original wheel changed')
package = pathlib.Path(yente.__file__).resolve().parent
compared = []
with zipfile.ZipFile(wheel) as archive:
    for name in archive.namelist():
        if name.startswith('yente/') and name.endswith('.py'):
            target = package / name[len('yente/'):]
            if not target.is_file() or target.read_bytes() != archive.read(name):
                raise RuntimeError('Installed yente source differs from original wheel: ' + name)
            compared.append(name)
if not compared:
    raise RuntimeError('The original wheel contained no selected yente source')
print(json.dumps({'packages':versions,'indexVersion':settings.INDEX_VERSION,
 'systemVersion':get_system_version(),'datasetIndex':build_index_name('un_sc_sanctions','20261012000104-kls'),
 'sourceRelease':'258c0a1fbcd9e7f70acdb113f19c28b7eac282b8','wheelSha256':sys.argv[2],
 'originalSourceFilesCompared':len(compared)}))
"""
    run("yente_version", [str(native_python), "-c", version_source, str(selected_yente_wheel),
                         YENTE_WHEEL_SHA256], environment=native_env, timeout=30)
    run("yente_original_reindex", [str(yente), "reindex"], environment=native_env, timeout=600)
    api_url = "http://127.0.0.1:" + str(yente_port)
    service = background("yente", [str(yente), "serve"], environment=native_env)
    poll_ready("yente", api_url, service, "/readyz")
    profile = matching.save_profile(domain, {
        "label": "Original yente 5.5 / OpenSearch 2.15 native receiving",
        "endpoint": api_url, "dataset": "un_sc_sanctions", "auth": {"kind": "none"},
        "parameters": {"algorithm": "logic-v2", "limit": 10, "threshold": 0.7},
        "sourceNote": "Original release " + YENTE_SOURCE + ", index version016, exact local source edition " +
                      AFTER_VERSION + "; retained public source-inspection portfolio and native receiving worker."
    })
    record("native_profile", profile)
    catalog_request = matching.prepare(domain, profile["id"], kind="catalog", edition=AFTER_ID)
    if catalog_request["state"] == "PREPARED":
        catalog_request = matching.dispatch(domain, catalog_request["id"], expected=catalog_request["revision"])
    if catalog_request["state"] != "RECEIVED" or catalog_request.get("response", {}).get("status") != 200:
        raise RuntimeError("The original native catalog request did not return HTTP200")
    catalog = json.loads(domain.object_path(catalog_request["response"]["object"]).read_bytes())
    record("nativeCatalogRequest", {"request": catalog_request, "catalog": catalog})
    selected_datasets = [d for d in catalog["datasets"] if d["name"] == "un_sc_sanctions"]
    if len(selected_datasets) != 1:
        raise RuntimeError("The native catalog does not contain exactly one selected dataset")
    indexed = selected_datasets[0]
    if (indexed["version"] != AFTER_VERSION or indexed["index_version"] != AFTER_VERSION
            or indexed["index_current"] is not True or "un_sc_sanctions" not in catalog["current"]):
        raise RuntimeError("The native catalog has not indexed the selected original dataset edition")
    record("native_indexed_edition", indexed)
    algorithms = retain_response("native-algorithms", api_url + "/algorithms", domain)
    record("native_algorithms", algorithms)
    if not any(a["name"] == "logic-v2" for a in algorithms["algorithms"]):
        raise RuntimeError("The selected original matching algorithm is unavailable")
    for name, kind, selected in [("nativeMatchRequest", "match", {"portfolio": PORTFOLIO_ID, "entity_ids": QUERIES}),
                                 ("nativeEntityRequest", "entity", {"entity_id": "Q94511220"})]:
        request = matching.prepare(domain, profile["id"], kind=kind, edition=AFTER_ID, **selected)
        record(name + "_prepared", request, {"id": request["id"], "state": request["state"], "url": request["url"],
                                             "requestSha256": request["requestSha256"]})
        if request["state"] == "PREPARED":
            request = matching.dispatch(domain, request["id"], expected=request["revision"])
        if request["state"] != "RECEIVED" or request.get("response", {}).get("status") != 200:
            raise RuntimeError("Original native operation did not receive HTTP200: " + name)
        readback = matching.response_view(domain, request["id"])
        record(name, {"request": request, "response": readback}, {"id": request["id"],
               "status": request["response"]["status"], "response": request["response"]["object"]})
        if name == "nativeMatchRequest":
            candidates = request["response"]["summary"]["candidates"]
            if "Q94511220" not in candidates.get(QUERIES[0], []):
                raise RuntimeError("The native engine did not return the original current candidate")
            again = matching.prepare(domain, profile["id"], kind=kind, edition=AFTER_ID, **selected)
            if again["id"] != request["id"] or again["state"] != "RECEIVED":
                raise RuntimeError("The same original screening request was not retained")
            record("native_match_identity", {"id": again["id"], "state": again["state"],
                   "candidate": "Q94511220", "case": CASE_ID, "caseHistory": len(current["history"])})
    exported = domain.export_packet(OUTPUT / "OpenSanctions_Native_Receiving_Workspace.zip")
    record("native_export", exported)
    ws.close(); ws = None
    receiver = Workspace(ROOT / "receiving", create=not (ROOT / "receiving").exists())
    try:
        received = receiver.opensanctions.import_packet(OUTPUT / "OpenSanctions_Native_Receiving_Workspace.zip")
        original_case = receiver.opensanctions.case_history(CASE_ID)
        original_request = receiver.opensanctions._one("requests", report["results"]["nativeMatchRequest"]["request"]["id"])
        query = receiver.query(after["build"], {"where_id": "Q94511220", "fields": "id,schema", "limit": "5"})
        if len(original_case["history"]) != 2 or original_request["state"] != "RECEIVED" or query["response"]["status"] != 200:
            raise RuntimeError("Native receiving source, case or original response changed")
        record("native_receiving", {"receipt": received, "case": original_case,
               "request": original_request, "query": query},
               {"builds": len(received["builds"]), "editions": received["editions"],
                "caseHistory": len(original_case["history"]), "nativeRequest": original_request["id"],
                "nativeState": original_request["state"], "queryStatus": query["response"]["status"]})
    finally: receiver.close()
    report["status"] = "NATIVE_RECEIVING_COMPLETE"
    report["completedAt"] = time.time()
except SystemExit:
    raise
except Exception as error:
    report["status"] = "NATIVE_RECEIVING_FAILED"
    report["error"] = {"type": type(error).__name__, "message": str(error),
                       "traceback": traceback.format_exc(), "at": time.time()}
    print(json.dumps({"status": report["status"], "error": report["error"]}), flush=True)
    raise
finally:
    if ws is not None:
        try:
            retained = ws.opensanctions.export_packet(OUTPUT / "OpenSanctions_Current_Workspace.zip")
            report["retainedWorkspace"] = retained
        except Exception as retain_error:
            report["workspaceExportError"] = {"type": type(retain_error).__name__, "message": str(retain_error)}
        with contextlib.suppress(Exception): ws.close()
    for child in reversed(children):
        with contextlib.suppress(Exception): stop(child)
    for handle in handles: handle.close()
    report["processesClosedAt"] = time.time()
    write_json(RESULT, report)
    members = [path for path in OUTPUT.iterdir() if path.is_file() and path.name not in {
               "native-return.tar.gz", "run-artifacts.json"} and not path.name.endswith(".pending")]
    manifest = {"schema": "starforge.native-artifacts.v1", "operation": OPERATION,
                "status": report["status"], "files": [{"file": path.name, "bytes": path.stat().st_size,
                  "sha256": digest(path)} for path in sorted(members)]}
    write_json(OUTPUT / "run-artifacts.json", manifest)
    with tarfile.open(OUTPUT / "native-return.tar.gz", "w:gz") as archive:
        for path in members + [OUTPUT / "run-artifacts.json"]:
            archive.add(path, arcname=path.name, recursive=False)
    print(json.dumps({"status": report["status"], "result": str(RESULT),
          "artifacts": str(OUTPUT / "run-artifacts.json"), "archive": str(OUTPUT / "native-return.tar.gz"),
          "archiveBytes": (OUTPUT / "native-return.tar.gz").stat().st_size,
          "archiveSha256": digest(OUTPUT / "native-return.tar.gz")}), flush=True)

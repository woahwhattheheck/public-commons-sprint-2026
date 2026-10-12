#!/usr/bin/env python3
"""Dwellir application migration operator. Python 3.10+, standard library."""
from __future__ import annotations
import argparse, contextlib, datetime as dt, fcntl, hashlib, json, os, re
import shlex, shutil, stat, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

SCHEMA = "dwellir.application-migration.v1"
CLI_PIN = "f49ef22ffa38f611c46e700c7b618ef98d648d04"
CATALOG = "https://www.dwellir.com/public-rpc-endpoints.json"
MAX_FILE = 1024 * 1024
READ_METHODS = {
    "chain_getBlockHash", "chain_getFinalizedHead", "chain_getHeader",
    "state_getRuntimeVersion", "state_getStorage", "system_chain",
    "system_health", "rpc_methods",
}
HEX_HASH = re.compile(r"0x[0-9a-f]{64}\Z")
ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")

class MigrationError(Exception):
    pass

def require(condition, message):
    if not condition:
        raise MigrationError(message)

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def digest(data):
    return hashlib.sha256(data).hexdigest()

def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()

def read_file(path, limit=MAX_FILE):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode), "Expected a regular file: " + str(path))
    require(info.st_size <= limit, "File exceeds the reviewed size limit: " + str(path))
    with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)), "rb") as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, "File exceeds the reviewed size limit: " + str(path))
    return data

def read_json(path):
    try:
        return json.loads(read_file(path))
    except (ValueError, UnicodeError) as exc:
        raise MigrationError("Invalid retained JSON: " + str(path)) from exc

def atomic(path, data, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix=".migration-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def save(path, value):
    atomic(path, encoded(value))

def child(root, relative):
    require(isinstance(relative, str) and relative and not Path(relative).is_absolute(),
            "Application paths must be relative to the selected project")
    candidate = Path(root) / relative
    require(".." not in Path(relative).parts, "Parent traversal is not an application path")
    current = Path(root)
    for part in Path(relative).parts:
        current /= part
        require(not current.is_symlink(), "Application path contains a symlink")
    resolved = candidate.resolve()
    require(resolved.is_relative_to(Path(root).resolve()), "Application path left the selected project")
    return resolved

def assignment(line):
    match = re.match(r"^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=(.*?)(\r?\n)?$", line)
    return match

def env_value(data, name):
    require(ENV_NAME.fullmatch(name), "Invalid environment variable name")
    found = []
    for line in data.decode("utf-8").splitlines(keepends=True):
        match = assignment(line)
        if match and match.group(2) == name:
            try:
                parts = shlex.split(match.group(3), comments=True, posix=True)
            except ValueError as exc:
                raise MigrationError("Use a complete single-line value for " + name) from exc
            require(len(parts) == 1 and "$" not in parts[0] and "\x00" not in parts[0],
                    "Use a literal single-line endpoint for " + name)
            found.append(parts[0])
    require(len(found) == 1, "Expected one existing assignment for " + name)
    return found[0]

def change_env(data, name, value):
    env_value(data, name)
    require(not any(char in value for char in "'\r\n\x00"), "Endpoint is not a supported environment value")
    result = []
    for line in data.decode("utf-8").splitlines(keepends=True):
        match = assignment(line)
        if match and match.group(2) == name:
            line = match.group(1) + name + "='" + value + "'" + (match.group(4) or "")
        result.append(line)
    return "".join(result).encode("utf-8")

def change_json(data, pointer, value):
    require(isinstance(pointer, str) and pointer.startswith("/") and pointer != "/",
            "JSON binding requires a nonempty JSON pointer")
    obj = json.loads(data)
    keys = [item.replace("~1", "/").replace("~0", "~") for item in pointer[1:].split("/")]
    current = obj
    for key in keys[:-1]:
        current = current[int(key)] if isinstance(current, list) else current[key]
    key = keys[-1]
    index = int(key) if isinstance(current, list) else key
    require(isinstance(current[index], str), "The existing JSON endpoint binding must be a string")
    current[index] = value
    return encoded(obj)

def endpoint(value, dwellir=False, public=False):
    parsed = urllib.parse.urlsplit(value)
    require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password,
            "Use a complete HTTPS RPC endpoint")
    require(parsed.port in (None, 443) and not parsed.fragment, "Unsupported endpoint authority or fragment")
    if dwellir:
        require(parsed.hostname.endswith(".dwellir.com"), "The selected candidate must be a Dwellir host")
        require(not parsed.query, "The selected Dwellir endpoint uses URL-path authentication")
    if public:
        require(parsed.path in ("", "/") and not parsed.query, "Public receiving uses the published keyless endpoint")
    require("<" not in value and ">" not in value, "Resolve the endpoint through native Dwellir project setup")
    return value

def endpoint_label(value):
    parsed = urllib.parse.urlsplit(value)
    return {"scheme": parsed.scheme, "host": parsed.hostname, "port": parsed.port or 443}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def fetch_bytes(url, body=None, timeout=15, maximum=MAX_FILE):
    headers = {"Accept": "application/json", "User-Agent": "commons-dwellir-migration/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers)
    start = time.monotonic()
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            data = response.read(maximum + 1)
            require(len(data) <= maximum, "Provider response exceeded the selected byte limit")
            status = response.status
    except urllib.error.HTTPError as exc:
        raise MigrationError("Provider returned HTTP " + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise MigrationError("Provider transport did not complete; retained configuration is available") from None
    require(status == 200, "Provider returned an unexpected HTTP status")
    return data, {"utc": utc(), "httpStatus": status,
                  "elapsedMilliseconds": round((time.monotonic() - start) * 1000, 3),
                  "bytes": len(data), "sha256": digest(data)}

def native_command(project, binary, profile, arguments):
    executable = shutil.which(binary) if not Path(binary).is_absolute() else binary
    require(executable and Path(executable).is_file(), "Select the installed native Dwellir CLI")
    command = [str(executable)] + (["--profile", profile] if profile else []) + arguments + ["--json"]
    result = subprocess.run(command, cwd=project, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    require(result.returncode == 0, "The native Dwellir command did not complete; inspect that original CLI/account")
    require(len(result.stdout) <= MAX_FILE, "Native CLI output exceeded the retained size limit")
    try:
        value = json.loads(result.stdout)
    except ValueError as exc:
        raise MigrationError("The selected CLI must return its native --json envelope") from exc
    require(value.get("ok") is True, "The native Dwellir command returned an unsuccessful envelope")
    return result.stdout, value

def native_setup(project, chain, network, key_name, profile=None, binary="dwellir",
                 env_file=".env.local", node_type=None):
    project = Path(project).resolve(strict=True)
    require(env_file in (".env", ".env.local"), "Use the native .env or .env.local target")
    arguments = ["project", "setup", "--chain", chain, "--network", network,
                 "--key-name", key_name, "--env-file", env_file]
    if node_type:
        arguments += ["--node-type", node_type]
    _, result = native_command(project, binary, profile, arguments)
    configured = result.get("data", {})
    require(configured.get("configured") is True, "The native project setup did not confirm configuration")
    env_path = child(project, env_file)
    candidate = endpoint(env_value(read_file(env_path), "DWELLIR_RPC_URL"), dwellir=True)
    require(env_path.stat().st_mode & 0o077 == 0, "Native credential configuration must remain private")
    return {"configured": True, "file": env_file, "endpoint": endpoint_label(candidate),
            "nativeCliSource": CLI_PIN, "keySelection": "existing named key"}

class Capture:
    def __init__(self, directory, plan):
        self.directory, self.plan, self.rows, self.counter = Path(directory), plan, [], 0
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.retained = []
        for prior in sorted(self.directory.parent.glob("*/manifest.json"), reverse=True):
            if prior.parent == self.directory:
                continue
            try:
                self.retained.extend((prior.parent, row) for row in read_json(prior)["calls"])
            except (OSError, ValueError, KeyError, MigrationError):
                continue

    def retained_response(self, url, request_sha):
        maximum_age = self.plan.get("resumeMaxAgeSeconds", 900)
        for directory, row in self.retained:
            if row.get("requestSha256") != request_sha or row.get("endpoint") != endpoint_label(url):
                continue
            current_url_sha = digest(url.encode())
            parsed = urllib.parse.urlsplit(url)
            legacy_public = not row.get("endpointSha256") and parsed.path in ("", "/") and not parsed.query
            if row.get("endpointSha256") != current_url_sha and not legacy_public:
                continue
            try:
                observed = dt.datetime.fromisoformat(row["utc"].replace("Z", "+00:00"))
                age = (dt.datetime.now(dt.timezone.utc) - observed).total_seconds()
                if not 0 <= age <= maximum_age:
                    continue
                raw_request = read_file(directory / (row["name"] + ".request.json"))
                raw_response = read_file(directory / (row["name"] + ".response.json"))
                if digest(raw_request) != request_sha or digest(raw_response) != row["sha256"]:
                    continue
                metadata = {key: row[key] for key in ("utc", "httpStatus", "elapsedMilliseconds", "bytes", "sha256")}
                metadata.update(reusedFrom=str((directory / row["name"]).relative_to(self.directory.parent.parent)),
                                reusedAt=utc(), endpointSha256=current_url_sha)
                return raw_response, metadata
            except (OSError, ValueError, KeyError, MigrationError):
                continue
        return None

    def rpc(self, label, url, method, params):
        require(method in READ_METHODS, "The selected call is outside this read-only migration contract")
        self.counter += 1
        request_id = "migration-" + str(self.counter)
        request = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        raw_request = encoded(request)
        stem = "%03d-%s-%s" % (self.counter, label, method)
        atomic(self.directory / (stem + ".request.json"), raw_request)
        retained = self.retained_response(url, digest(raw_request))
        if retained:
            raw, metadata = retained
        else:
            raw, metadata = fetch_bytes(url, raw_request, self.plan.get("timeoutSeconds", 15),
                                        self.plan.get("maxResponseBytes", MAX_FILE))
            metadata["endpointSha256"] = digest(url.encode())
        atomic(self.directory / (stem + ".response.json"), raw)
        result = json.loads(raw)
        require(isinstance(result, dict) and result.get("jsonrpc") == "2.0" and result.get("id") == request_id,
                "Provider response did not match the retained JSON-RPC request")
        require("error" not in result and "result" in result,
                "Provider returned a JSON-RPC error; review the retained response")
        row = {"name": stem, "endpoint": endpoint_label(url), "method": method,
               "requestSha256": digest(raw_request), **metadata}
        self.rows.append(row)
        save(self.directory / "manifest.json", {"calls": self.rows})
        return result["result"]

def observe(operation, plan, baseline, candidate):
    provider = operation / "provider"
    provider.mkdir(mode=0o700, exist_ok=True)
    attempt = provider / ("%03d" % (len(list(provider.iterdir())) + 1))
    cap = Capture(attempt, plan)
    outcomes = {}
    expected = plan["expectedGenesis"]
    for name, url in (("baseline", baseline), ("candidate", candidate)):
        genesis = cap.rpc(name, url, "chain_getBlockHash", [0])
        require(genesis == expected, name + " returned a different genesis hash")
        chain = cap.rpc(name, url, "system_chain", [])
        require(chain == plan.get("chainName", "Polkadot"), name + " returned a different chain name")
        health = cap.rpc(name, url, "system_health", [])
        require(isinstance(health, dict) and health.get("isSyncing") is False, name + " is not ready for migration")
        head = cap.rpc(name, url, "chain_getFinalizedHead", [])
        require(isinstance(head, str) and HEX_HASH.fullmatch(head), "Provider returned an invalid finalized hash")
        header = cap.rpc(name, url, "chain_getHeader", [head])
        require(isinstance(header, dict) and isinstance(header.get("number"), str), "Finalized header is unavailable")
        outcomes[name] = {"genesis": genesis, "chain": chain, "head": head,
                          "height": int(header["number"], 16), "health": health}
    require(outcomes["candidate"]["height"] + plan.get("maxFinalizedLag", 8) >= outcomes["baseline"]["height"],
            "The candidate finalized head is behind the reviewed lag")
    anchored = outcomes["baseline"]["head"]
    compare = {}
    for method in ("chain_getHeader", "state_getRuntimeVersion"):
        before = cap.rpc("baseline-anchored", baseline, method, [anchored])
        after = cap.rpc("candidate-anchored", candidate, method, [anchored])
        require(before is not None and before == after, "The selected providers differ at the same finalized block: " + method)
        compare[method] = digest(encoded(before))
    methods = cap.rpc("candidate", candidate, "rpc_methods", [])
    require(isinstance(methods, dict) and isinstance(methods.get("methods"), list), "RPC method discovery is unavailable")
    missing = set(plan.get("requiredMethods", [])) - set(methods["methods"])
    require(not missing, "Candidate does not advertise required application methods: " + ", ".join(sorted(missing)))
    history = []
    for item in plan.get("historicalProbes", []):
        method, params = item["method"], item["params"]
        require(method in {"chain_getHeader", "state_getRuntimeVersion", "state_getStorage"},
                "Historical probes use header, runtime, or storage reads")
        require(isinstance(params, list) and params and isinstance(params[-1], str)
                and HEX_HASH.fullmatch(params[-1]), "Historical probe must bind an exact block hash")
        before = cap.rpc("baseline-history", baseline, method, params)
        after = cap.rpc("candidate-history", candidate, method, params)
        require(before == after and (before is not None or item.get("allowNull") is True),
                "Historical read differs or is unavailable: " + item["name"])
        history.append({"name": item["name"], "method": method, "resultSha256": digest(encoded(before))})
    return {"utc": utc(), "endpoints": outcomes, "anchoredBlock": anchored,
            "anchoredResults": compare, "historical": history,
            "requiredMethods": plan.get("requiredMethods", []), "callCount": len(cap.rows),
            "providerDirectory": str(attempt.relative_to(operation)),
            "reusedCallCount": sum("reusedFrom" in row for row in cap.rows),
            "networkCallCount": sum("reusedFrom" not in row for row in cap.rows)}

def validate_plan(plan):
    require(plan.get("schema") == SCHEMA, "Select a supported migration plan")
    require(plan.get("family") == "substrate", "This product operates the selected Substrate RPC contract")
    require(HEX_HASH.fullmatch(plan.get("expectedGenesis", "")), "Retain the intended network genesis hash")
    require(1 <= len(plan.get("bindings", [])) <= 3, "Select one to three application bindings")
    require(0 < plan.get("timeoutSeconds", 15) <= 60, "Timeout must be at most 60 seconds")
    require(0 < plan.get("maxResponseBytes", MAX_FILE) <= MAX_FILE, "Response limit must be at most one MiB")
    require(0 <= plan.get("resumeMaxAgeSeconds", 900) <= 3600, "Retained-response age must be at most one hour")
    require(set(plan.get("requiredMethods", [])) <= READ_METHODS, "Application methods require this product's explicit contract")
    require(plan["candidate"]["mode"] in ("published-public", "native-project"), "Select published-public or native-project")
    return plan

def no_tracked_secret(project, path):
    info = path.stat()
    require(info.st_uid == os.geteuid(), "Selected configuration must be owned by this operator")
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=project, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE)
    if result.returncode == 0:
        tracked = subprocess.run(["git", "ls-files", "--error-unmatch", "--", str(path.relative_to(project))],
                                 cwd=project, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        require(tracked.returncode == 1, "Credential-bearing application configuration must be untracked")
        ignored = subprocess.run(["git", "check-ignore", "--quiet", "--", str(path.relative_to(project))],
                                 cwd=project, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        require(ignored.returncode == 0, "Credential-bearing application configuration must be ignored")

def review_changes(project, operation, plan, candidate):
    snapshots = operation / "snapshots"
    snapshots.mkdir(mode=0o700, exist_ok=True)
    grouped = {}
    for binding in plan["bindings"]:
        grouped.setdefault(binding["path"], []).append(binding)
    files = []
    for index, (relative, bindings) in enumerate(grouped.items()):
        path = child(project, relative)
        before = read_file(path)
        info = path.stat()
        require(info.st_uid == os.geteuid(), "Configuration must be owned by the selected operator")
        after = before
        for binding in bindings:
            if binding["kind"] == "env":
                after = change_env(after, binding["name"], candidate)
            elif binding["kind"] == "json":
                after = change_json(after, binding["pointer"], candidate)
            else:
                raise MigrationError("Binding kind must be env or json")
        private = plan["candidate"]["mode"] == "native-project"
        if private:
            no_tracked_secret(project, path)
        mode = 0o600 if private else stat.S_IMODE(info.st_mode)
        require(before != after, "Selected binding already uses this candidate; reopen its existing operation")
        before_name, after_name = "%03d.before" % index, "%03d.after" % index
        atomic(snapshots / before_name, before)
        atomic(snapshots / after_name, after)
        files.append({"path": relative, "before": before_name, "after": after_name,
                      "beforeSha256": digest(before), "afterSha256": digest(after),
                      "beforeMode": stat.S_IMODE(info.st_mode), "afterMode": mode})
    return files

def audit_sources(project, plan):
    result = []
    for relative in plan.get("sourceFiles", []):
        data = read_file(child(project, relative))
        text = data.decode("utf-8")
        methods = sorted(method for method in READ_METHODS if method in text)
        env_refs = sorted(set(re.findall(r"\b[A-Z][A-Z0-9_]*(?:RPC|WSS)[A-Z0-9_]*\b", text)))
        result.append({"path": relative, "sha256": digest(data), "bytes": len(data),
                       "rpcMethods": methods, "environmentReferences": env_refs,
                       "websocketReferences": any(token in text for token in ("WebSocket", "WsProvider", "wss://")),
                       "historicalReferences": any(token in text for token in ("state_getStorage", "archive", "historic"))})
    return result

def prepare(plan_file, project, operation, resume=False):
    plan = validate_plan(read_json(plan_file))
    project, operation = Path(project).resolve(strict=True), Path(operation).absolute()
    require(not operation.resolve().is_relative_to(project), "Retain the private operation outside the application")
    if not resume:
        require(not operation.exists(), "Reopen the retained operation instead of replacing it")
        operation.mkdir(parents=True, mode=0o700)
        save(operation / "plan.json", plan)
        save(operation / "operation.json", {"schema": SCHEMA, "state": "PREPARING", "project": str(project),
                                          "createdAt": utc(), "files": []})
    else:
        require(operation.exists(), "Select the existing incomplete preparation")
    with operation_lock(operation) as operation:
        prior = read_json(operation / "operation.json")
        require(prior["state"] in ("PREPARING", "PREPARATION_INCOMPLETE"),
                "Use inspect/apply/rollback for the completed retained review")
        require(prior["project"] == str(project) and read_json(operation / "plan.json") == plan,
                "Preparation uses the same exact plan and project")
        for item in prior.get("files", []):
            require(digest(read_file(child(project, item["path"]))) == item["beforeSha256"],
                    "Application configuration changed during incomplete preparation")
        try:
            baseline_spec = plan["baseline"]
            baseline = endpoint(env_value(read_file(child(project, baseline_spec["file"])), baseline_spec["name"]))
            specification = plan["candidate"]
            if specification["mode"] == "published-public":
                candidate = endpoint(specification["url"], dwellir=True, public=True)
                catalog_raw, metadata = fetch_bytes(CATALOG)
                catalog = json.loads(catalog_raw)
                rows = catalog.get("networks", [])
                matches = [(index, row) for index, row in enumerate(rows)
                           if row.get("chain", "").casefold() == plan["chain"].casefold()
                           and row.get("network", "").casefold() == plan["network"].casefold()
                           and row.get("https") == candidate and row.get("access") == "public"]
                require(len(matches) == 1, "Select one current published keyless endpoint for the exact chain/network")
                atomic(operation / "endpoint-catalog.json", catalog_raw)
                discovery = {"source": CATALOG, "selectedIndex": matches[0][0],
                             "selectedNetwork": matches[0][1], **metadata}
            else:
                candidate_path = child(project, specification.get("file", ".env.local"))
                require(candidate_path.stat().st_mode & 0o077 == 0, "Keep the native environment private")
                candidate = endpoint(env_value(read_file(candidate_path), "DWELLIR_RPC_URL"), dwellir=True)
                arguments = ["endpoints", "get", plan["chain"], "--network", plan["network"], "--protocol", "https"]
                if specification.get("nodeType"):
                    arguments += ["--node-type", specification["nodeType"]]
                native_raw, native = native_command(project, specification.get("binary", "dwellir"),
                                                   specification.get("profile"), arguments)
                templates = []
                def collect(value):
                    if isinstance(value, dict):
                        for key, item in value.items():
                            if key == "https" and isinstance(item, str):
                                templates.append(item)
                            else:
                                collect(item)
                    elif isinstance(value, list):
                        for item in value:
                            collect(item)
                collect(native.get("data"))
                matching = [item for item in templates if re.fullmatch(re.escape(item).replace(re.escape("<key>"), r"[^/?#]+"), candidate)]
                require(len(matching) == 1, "Native endpoint selection must identify the exact configured candidate")
                atomic(operation / "native-endpoints.json", native_raw)
                discovery = {"source": "dwellir endpoints get", "nativeCliSource": CLI_PIN,
                             "sha256": digest(native_raw), "selectedEndpoint": endpoint_label(candidate)}
            sources = audit_sources(project, plan)
            files = review_changes(project, operation, plan, candidate)
            save(operation / "operation.json", {"schema": SCHEMA, "state": "PREPARING", "project": str(project),
                                              "createdAt": utc(), "files": files})
            observation = observe(operation, plan, baseline, candidate)
            review = {"schema": SCHEMA, "createdAt": utc(), "chain": plan["chain"], "network": plan["network"],
                      "expectedGenesis": plan["expectedGenesis"], "baseline": endpoint_label(baseline),
                      "candidate": endpoint_label(candidate), "discovery": discovery,
                      "files": files, "sources": sources, "observation": observation,
                      "applicationMethods": plan.get("requiredMethods", [])}
            raw = encoded(review)
            atomic(operation / "review.json", raw)
            save(operation / "operation.json", {"schema": SCHEMA, "state": "REVIEW_READY", "project": str(project),
                                              "createdAt": review["createdAt"], "reviewSha256": digest(raw), "files": files})
            return {"state": "REVIEW_READY", "operation": str(operation), "reviewSha256": digest(raw),
                    "files": len(files), "providerCalls": observation["callCount"], "anchoredBlock": observation["anchoredBlock"]}
        except Exception:
            retained = read_json(operation / "operation.json")
            retained.update(state="PREPARATION_INCOMPLETE", updatedAt=utc())
            save(operation / "operation.json", retained)
            raise

@contextlib.contextmanager
def operation_lock(operation):
    operation = Path(operation).resolve(strict=True)
    require(operation.stat().st_mode & 0o077 == 0, "Retained operation must remain private")
    with open(operation / ".operator.lock", "a+b") as lock:
        os.chmod(operation / ".operator.lock", 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield operation

def inspected(operation):
    state = read_json(operation / "operation.json")
    require(state.get("reviewSha256"), "Preparation did not complete; inspect its retained provider result")
    require(digest(read_file(operation / "review.json")) == state["reviewSha256"], "Retained review changed")
    require(read_json(operation / "review.json")["files"] == state["files"], "Operation and reviewed file selection differ")
    actual = []
    for item in state["files"]:
        for version in ("before", "after"):
            require(digest(read_file(operation / "snapshots" / item[version])) == item[version + "Sha256"],
                    "Retained configuration snapshot changed")
        path = child(state["project"], item["path"])
        current = digest(read_file(path))
        position = "after" if current == item["afterSha256"] else "before" if current == item["beforeSha256"] else "changed"
        actual.append({"path": item["path"], "position": position, "sha256": current})
    return state, actual

def inspect(operation):
    with operation_lock(operation) as op:
        state, actual = inspected(op)
        positions = {item["position"] for item in actual}
        observed = "ACTIVE" if positions == {"after"} else "ORIGINAL" if positions == {"before"} else "CONFLICT" if "changed" in positions else "PARTIAL"
        return {"state": state["state"], "observed": observed, "reviewSha256": state["reviewSha256"],
                "files": actual, "operation": str(op)}

def transition(operation, direction, review_sha=None):
    with operation_lock(operation) as op:
        state, actual = inspected(op)
        require(all(item["position"] != "changed" for item in actual),
                "Application configuration changed after review; preserve that edit and review a new operation")
        if direction == "after":
            require(review_sha == state["reviewSha256"], "Apply the exact selected review SHA-256")
            for source in read_json(op / "review.json")["sources"]:
                require(digest(read_file(child(state["project"], source["path"]))) == source["sha256"],
                        "Selected application source changed after review")
        target_state = "ACTIVE" if direction == "after" else "ROLLED_BACK"
        state.update(state="APPLYING" if direction == "after" else "ROLLING_BACK", updatedAt=utc())
        save(op / "operation.json", state)
        for item in state["files"]:
            path = child(state["project"], item["path"])
            current = digest(read_file(path))
            require(current in (item["beforeSha256"], item["afterSha256"]), "Configuration changed during operation")
            if current != item[direction + "Sha256"]:
                atomic(path, read_file(op / "snapshots" / item[direction]), item[direction + "Mode"])
            require(digest(read_file(path)) == item[direction + "Sha256"], "Configuration readback differs")
        state.update(state=target_state, updatedAt=utc())
        save(op / "operation.json", state)
    return inspect(operation)

def export_handoff(operation, output):
    with operation_lock(operation) as op:
        state, actual = inspected(op)
        out = Path(output).absolute()
        require(not out.resolve().is_relative_to(op), "Export outside the retained operation")
        marker = {"schema": "dwellir.handoff-intent.v1", "reviewSha256": state["reviewSha256"]}
        if out.exists():
            require(out.is_dir() and not out.is_symlink() and out.stat().st_mode & 0o077 == 0,
                    "Resume the original private handoff directory")
            require(read_json(out / "handoff-intent.json") == marker, "The handoff belongs to another selection")
            if (out / "handoff.json").exists():
                retained = read_json(out / "handoff.json")
                for item in retained["files"]:
                    require(digest(read_file(child(out, item["path"]))) == item["sha256"], "Completed handoff file changed")
                return {"output": str(out), "files": len(retained["files"]),
                        "manifestSha256": digest(read_file(out / "handoff.json")), "reopened": True}
        else:
            out.mkdir(parents=True, mode=0o700)
            save(out / "handoff-intent.json", marker)
        selection = {}
        def copy(relative, raw):
            atomic(child(out, relative), raw, 0o644)
            selection[relative] = {"path": relative, "bytes": len(raw), "sha256": digest(raw)}
        copy("review.json", read_file(op / "review.json"))
        copy("plan.json", read_file(op / "plan.json"))
        source_root = Path(__file__).parent
        for name in ("dwellir_migration.py", "README.md", "OPERATOR.md", "SOURCE_MAP.json",
                     "apps/polkadot_reader.py", "apps/polkadot_reader.mjs",
                     "examples/polkadot-plan.json", "delivery/native_receiving.py"):
            source = source_root / name
            if source.is_file():
                copy(name, read_file(source))
        provider_dir = read_json(op / "review.json")["observation"]["providerDirectory"]
        for source in sorted((op / provider_dir).iterdir()):
            if source.is_file() and source.suffix == ".json":
                copy("provider/" + source.name, read_file(source))
        retained = {"schema": "dwellir.migration-handoff.v1", "createdAt": utc(),
                    "operationState": state["state"], "configuration": actual,
                    "reviewSha256": state["reviewSha256"], "nativeCliSource": CLI_PIN,
                    "files": [selection[name] for name in sorted(selection)]}
        save(out / "handoff.json", retained)
        return {"output": str(out), "files": len(selection), "manifestSha256": digest(read_file(out / "handoff.json"))}

def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    commands = parser.add_subparsers(dest="command", required=True)
    setup = commands.add_parser("native-setup", allow_abbrev=False)
    for name in ("project", "chain", "network", "key-name"):
        setup.add_argument("--" + name, required=True)
    setup.add_argument("--profile")
    setup.add_argument("--binary", default="dwellir")
    setup.add_argument("--env-file", choices=(".env", ".env.local"), default=".env.local")
    setup.add_argument("--node-type")
    prepare_parser = commands.add_parser("prepare", allow_abbrev=False)
    for name in ("plan", "project", "operation"):
        prepare_parser.add_argument("--" + name, required=True)
    prepare_parser.add_argument("--resume", action="store_true")
    for name in ("inspect", "apply", "rollback", "handoff"):
        command = commands.add_parser(name, allow_abbrev=False)
        command.add_argument("--operation", required=True)
        if name == "apply":
            command.add_argument("--review-sha256", required=True)
        if name == "handoff":
            command.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        if args.command == "native-setup":
            result = native_setup(args.project, args.chain, args.network, args.key_name, args.profile,
                                  args.binary, args.env_file, args.node_type)
        elif args.command == "prepare":
            result = prepare(args.plan, args.project, args.operation, args.resume)
        elif args.command == "inspect":
            result = inspect(args.operation)
        elif args.command == "apply":
            result = transition(args.operation, "after", args.review_sha256)
        elif args.command == "rollback":
            result = transition(args.operation, "before")
        else:
            result = export_handoff(args.operation, args.output)
        print(json.dumps({"ok": True, "result": result}, sort_keys=True))
    except (MigrationError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"ok": False, "error": str(exc) if isinstance(exc, MigrationError)
                          else "The operation could not complete; inspect its retained files and selected input"}), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

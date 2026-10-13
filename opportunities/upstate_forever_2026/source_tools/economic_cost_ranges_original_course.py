"""Operate sourced cost ranges through the existing Eco operator and cold receive its whole Workspace.

Copyright (c) 2026 TokenJunkie Labs. MIT License.
No native ecological model is rerun; amounts come only from the exact authored input.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import signal
import stat
import subprocess
import sys
import time
import uuid
import zipfile

OPERATION = "ECO-COST-RANGES-B43A-20261013"
ACTION = "economic.cost-ranges.build"
SCHEMA = "upstate.economic-cost-ranges-course/v1"

def require(condition, message):
    if not condition:
        raise ValueError(message)

def now():
    return datetime.now(timezone.utc).isoformat()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def read_json(path):
    def bad(value):
        raise ValueError("Nonfinite JSON number: " + value)
    return json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=bad)

def same_json(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isfinite(left) and math.isfinite(right) and left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(same_json(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(same_json(a, b) for a, b in zip(left, right))
    return left == right

def browser_definition(node, original_raw, target, timeout):
    if target.exists():
        raw = target.read_bytes()
    else:
        # Use the existing JavaScript runtime's actual JSON wire representation.
        # The literal authored file remains separate and unchanged.
        code = 'process.stdout.write(JSON.stringify(JSON.parse(require("node:fs").readFileSync(0,"utf8")))+"\\n")'
        result = subprocess.run([node, "-e", code], input=original_raw, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
        require(result.returncode == 0, "The actual browser JSON runtime could not read the original authored definition: " +
                result.stderr.decode("utf-8", errors="replace"))
        raw = result.stdout
    value = json.loads(raw)
    require(same_json(value, json.loads(original_raw)),
            "The browser JSON representation would change an original source value; preserve the file and correct that input.")
    return raw, value

def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def descriptor(path, root=None):
    path = Path(path)
    return {"file": path.relative_to(root).as_posix() if root else path.name,
            "bytes": path.stat().st_size, "sha256": file_hash(path)}

def directory_sync(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def write(path, raw, *, immutable=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and immutable:
        require(path.is_file() and not path.is_symlink() and path.read_bytes() == raw,
                "Retained original output changed: " + str(path))
        directory_sync(path.parent)
        return
    temporary = path.with_name("." + path.name + "-" + uuid.uuid4().hex + ".pending")
    try:
        with temporary.open("xb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                os.link(temporary, path)
            except FileExistsError:
                require(path.read_bytes() == raw, "Concurrent original output differs: " + str(path))
        else:
            os.replace(temporary, path)
        directory_sync(path.parent)
    finally:
        temporary.unlink(missing_ok=True)

def member(root, name):
    require(isinstance(name, str) and name and "\\" not in name and "\0" not in name,
            "Choose a canonical retained relative member.")
    parts = PurePosixPath(name).parts
    require(not name.startswith("/") and all(p not in ("", ".", "..") for p in parts)
            and PurePosixPath(name).as_posix() == name, "A member leaves its original output.")
    root = Path(root).resolve()
    path = root.joinpath(*parts)
    cursor = root
    for part in parts:
        cursor /= part
        require(not cursor.is_symlink(), "Retain ordinary original files, not symlinks.")
    require(path.resolve().is_relative_to(root), "A member leaves its output.")
    return path

def inspect_file(root, item):
    path = member(root, item["file"])
    require(path.is_file() and path.stat().st_size == item["bytes"] and file_hash(path) == item["sha256"],
            "Retained artifact changed: " + item["file"])
    return path

def source_inventory(app):
    files = []
    for path in sorted(app.rglob("*")):
        relative = path.relative_to(app)
        if any(part in {".git", "__pycache__", "node_modules", ".venv", "venv"} for part in relative.parts):
            continue
        require(not path.is_symlink(), "Selected application source contains a symlink: " + str(relative))
        if path.is_file():
            files.append(descriptor(path, app))
    require(files and any(x["file"] == "operator/economic_cost_ranges.py" for x in files),
            "Select the complete current application including the sourced ranges service.")
    return {"schema": "upstate.complete-application-source/v1", "files": files,
            "sha256": sha(encoded(files))}

class Course:
    def __init__(self, root, binding, token):
        self.root, self.token = root, token
        path = root / "course.json"
        self.state = read_json(path) if path.exists() else {
            "schema": SCHEMA, "binding": binding, "started_at": now(),
            "phases": {}, "requests": {}, "artifacts": {}, "complete": False}
        require(self.state["schema"] == SCHEMA and self.state["binding"] == binding,
                "Resume the same original application, input, operator origin, Workspace and operation.")
        self.save()

    def clean(self, value):
        if isinstance(value, str):
            return value.replace(self.token, "[redacted]")
        if isinstance(value, list):
            return [self.clean(x) for x in value]
        if isinstance(value, dict):
            return {k: self.clean(v) for k, v in value.items()}
        return value

    def save(self):
        write(self.root / "course.json", encoded(self.clean(self.state)), immutable=False)

    def keep(self, name, raw):
        path = member(self.root, name)
        write(path, raw)
        item = descriptor(path, self.root)
        self.state["artifacts"][name] = item
        self.save()
        return item

    def json(self, name, value):
        return self.keep(name, encoded(self.clean(value)))

    def observation(self, name, build, stable=None):
        if name in self.state["phases"]:
            slot = self.state["phases"][name]
            path = inspect_file(self.root, slot["artifact"])
            value = read_json(path)
            if stable:
                stable(value)
            return value
        path = self.root / "observations" / (name + ".json")
        if path.exists():
            value = read_json(path)
            if stable:
                stable(value)
        else:
            value = build()
            if stable:
                stable(value)
            write(path, encoded(self.clean(value)))
        item = self.keep(path.relative_to(self.root).as_posix(), path.read_bytes())
        self.state["phases"][name] = {"artifact": item, "completed_at": now()}
        self.save()
        return value

    def verify(self):
        for item in self.state["artifacts"].values():
            inspect_file(self.root, item)

def stable_result(value):
    return {key: deepcopy(value[key]) for key in
            ("schema", "id", "title", "edition_id", "definition", "identity", "files", "result")}

def queued(course, api, name, workspace, action, payload, timeout, *, request=None,
           resume_interrupted=False):
    from model.common import digest as native_digest
    slots = course.state["requests"]
    if name not in slots:
        retained = request or {"workspace": workspace, "action": action, "payload": deepcopy(payload),
                               "operation_id": "cost-ranges-" + uuid.uuid4().hex}
        require(retained["workspace"] == workspace and retained["action"] == action
                and same_json(retained["payload"], payload), "The browser request differs from this original operation.")
        slots[name] = {"request": retained, "created_at": now(), "state": "prepared"}
        course.save()
    slot = slots[name]
    original = slot["request"]
    require(original["workspace"] == workspace and original["action"] == action and same_json(original["payload"], payload),
            "The retained original queued action changed.")
    request_hash = native_digest({key: original[key] for key in ("workspace", "action", "payload")})
    def checked(task):
        require(task["workspace"] == workspace and task["action"] == action
                and same_json(task["payload"], original["payload"]) and task["request_sha256"] == request_hash,
                "The original native task differs from its selected input.")
        require(native_digest({key: task[key] for key in ("workspace", "action", "payload")}) == request_hash,
                "The native request hash changed.")
        if "task_id" in slot:
            require(slot["task_id"] == task["id"] and slot["accepted_operation_id"] == task["operation_id"],
                    "The accepted original queue identity changed.")
        else:
            slot.update(task_id=task["id"], accepted_operation_id=task["operation_id"],
                        request_sha256=request_hash)
        slot["state"] = task["state"]
        course.save()
        return task
    if slot.get("task_id"):
        task = checked(api.get("/api/task", id=slot["task_id"]))
    else:
        slot["state"] = "dispatching"
        course.save()
        posted = api.post("/api/actions", original, workspace)
        task = checked(posted.get("task", posted))
        # Legal active-request aliases retain the server's operation_id. GET is
        # mandatory even when POST returns an already-complete raw task.
        task = checked(api.get("/api/task", id=task["id"]))
    deadline = time.monotonic() + timeout
    resumed = False
    while task["state"] != "complete":
        if task["state"] in {"failed", "cancelled", "interrupted"}:
            require(resume_interrupted and not resumed,
                    "Inspect the retained original task " + task["id"] + " (" + task["state"] +
                    "); resume this same course with --resume-interrupted-tasks after correcting its cause.")
            slot.setdefault("resumptions", []).append({"at": now(), "id": task["id"], "state": task["state"]})
            course.save()
            api.post("/api/task/resume", {"id": task["id"]}, workspace)
            resumed = True
        require(time.monotonic() < deadline,
                "Original task remains active; resume this same course to rejoin it: " + task["id"])
        time.sleep(0.5)
        task = checked(api.get("/api/task", id=task["id"]))
    return checked(api.get("/api/task", id=task["id"]))

def download(course, api, ticket, name, expected):
    path = member(course.root, name)
    if path.exists():
        require(path.stat().st_size == expected["bytes"] and file_hash(path) == expected["sha256"],
                "Existing original attachment differs: " + name)
    else:
        api.download(ticket, path, expected=expected)
    return course.keep(name, path.read_bytes())

def saved_files(course, api, detail, prefix):
    result = []
    for item in detail["files"]:
        name = item["path"]
        matches = [ticket for ticket in detail["_downloads"]
                   if ticket.get("sha256") == item["sha256"] and ticket.get("bytes") == item["bytes"]
                   and (ticket.get("filename") == name or PurePosixPath(ticket.get("path", "")).name == name)]
        require(len(matches) == 1, "Choose the exact original published attachment: " + name)
        result.append(download(course, api, matches[0], prefix + "/" + name, item))
    return result

def verify_range_package(path, expected_id):
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        require(len(names) == len(set(names)) and all(not i.is_dir() and not (i.flag_bits & 1)
                and not stat.S_ISLNK(i.external_attr >> 16) for i in infos),
                "The saved cost-range archive must retain distinct ordinary original members.")
        for name in names:
            member(Path("/validation-root"), name)
        manifest = json.loads(archive.read("manifest.json"))
        require(manifest["schema"] == "upstate.economic-cost-ranges-package/v1"
                and manifest["id"] == expected_id, "The complete archive belongs to another saved range.")
        expected = {x["path"]: x for x in manifest["members"]}
        require(set(names) == set(expected) | {"manifest.json"},
                "The full range archive has different source members.")
        for name, item in expected.items():
            raw = archive.read(name)
            require(len(raw) == item["bytes"] and sha(raw) == item["sha256"],
                    "Original range archive member changed: " + name)
        return manifest

def browser(course, args, phase, config, lock_fd):
    root = course.root / "browser" / phase
    root.mkdir(parents=True, exist_ok=True)
    public_binding = {key: value for key, value in config.items() if key != "operatorUrl"}
    binding_file = root / "binding.json"
    write(binding_file, encoded(public_binding))
    result_path = root / "result.json"
    if result_path.exists():
        result = read_json(result_path)
        require(result["complete"] is True and result["binding"] == public_binding,
                "The completed browser belongs to another original phase.")
        for item in result["artifacts"]:
            inspect_file(root, item)
        for item in result["artifacts"]:
            course.keep("browser/" + phase + "/" + item["file"], inspect_file(root, item).read_bytes())
        course.json("browser/" + phase + "/result.json", result)
        return result
    private = course.root / ".private"
    private.mkdir(mode=0o700, exist_ok=True)
    config_path = private / (phase + "-browser.json")
    runtime_config = {**config, "output": str(root), "binding": public_binding,
                      "executable": args.browser_executable, "python": sys.executable,
                      "archiveInspector": str(Path(args.app) / "source_tools" / "economic_cost_ranges_original_course.py")}
    write(config_path, encoded(runtime_config), immutable=False)
    os.chmod(config_path, 0o600)
    script = Path(args.app) / "source_tools" / "economic_cost_ranges_browser.mjs"
    require(script.is_file(), "Install the complete reviewed original browser course.")
    log_path = root / "browser.log"
    environment = dict(os.environ, ECO_COST_RANGE_LOCK_FD=str(lock_fd))
    command = [args.node, str(script), "--config", str(config_path)]
    with log_path.open("ab") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                   env=environment, pass_fds=(lock_fd,), start_new_session=True)
        course.state["active_browser"] = {"pid": process.pid, "phase": phase, "started_at": now()}
        course.save()
        try:
            code = process.wait()
        except BaseException:
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                # Do not kill and release the inherited original lease while an
                # owned browser is uncertain. Its runner owns immediate cleanup.
                course.state["active_browser"]["state"] = "awaiting_original_browser_cleanup"
                course.save()
                raise RuntimeError("Original browser cleanup is still active; retain this operation and reconcile its owned process.")
            raise
        finally:
            if process.poll() is not None:
                course.state["active_browser"].update(returncode=process.returncode, ended_at=now())
                course.save()
    require(code == 0 and result_path.is_file(), "Original browser phase did not complete; retain its profile, request and log.")
    return browser(course, args, phase, config, lock_fd)

def upload(course, api, name, workspace, path):
    expected = descriptor(path)
    def perform():
        with Path(path).open("rb") as stream:
            with api.open("/api/upload", method="POST", raw=stream, filename=Path(path).name,
                          length=expected["bytes"], workspace=workspace) as response:
                return json.load(response)
    def valid(value):
        require(value["bytes"] == expected["bytes"] and value["sha256"] == expected["sha256"],
                "Original receiving upload differs from the complete Workspace archive.")
    return course.observation(name, perform, valid)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", required=True, help="Complete selected original application root")
    parser.add_argument("--operator-url-file", required=True, help="Private existing operator URL with its original capability fragment")
    parser.add_argument("--workspace", required=True, help="Actual original registered Workspace key")
    parser.add_argument("--definition", required=True, help="Complete explicitly authored range definition JSON")
    parser.add_argument("--output", required=True)
    parser.add_argument("--operation", default=OPERATION)
    parser.add_argument("--node", default="node")
    parser.add_argument("--browser-executable")
    parser.add_argument("--timeout-seconds", type=float, default=120)
    parser.add_argument("--task-timeout-seconds", type=float, default=1800)
    parser.add_argument("--resume-interrupted-tasks", action="store_true")
    args = parser.parse_args(argv)
    app, root = Path(args.app).resolve(), Path(args.output).resolve()
    require(app != root and not app.is_relative_to(root) and not root.is_relative_to(app),
            "Keep complete source and operation output disjoint.")
    require(Path(args.definition).resolve() != root and not Path(args.definition).resolve().is_relative_to(root),
            "Choose the immutable authored input outside the operation output.")
    sys.path[:0] = [str(app / "operator"), str(app)]
    import economic_receive as original
    from model import portable
    from model.common import digest as native_digest
    args.operator_url_env = ""
    original_url, origin, token = original.read_url(args)
    source = source_inventory(app)
    definition_raw = Path(args.definition).read_bytes()
    authored_definition = json.loads(definition_raw)
    require(authored_definition.get("schema") == "upstate.economic-cost-ranges-definition/v1",
            "Supply the complete reviewed source-bound range definition.")
    root.mkdir(parents=True, exist_ok=True)
    with (root / "course.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        browser_raw, definition = browser_definition(args.node, definition_raw,
            root / "Browser_Authored_Definition.json", args.timeout_seconds)
        binding = {"operation": args.operation, "source_sha256": source["sha256"], "origin": origin,
                   "workspace": args.workspace, "definition_file": {"bytes": len(definition_raw), "sha256": sha(definition_raw)},
                   "definition_sha256": native_digest(authored_definition),
                   "browser_definition_file": {"bytes": len(browser_raw), "sha256": sha(browser_raw)},
                   "browser_definition_sha256": native_digest(definition)}
        course = Course(root, binding, token)
        course.keep("Original_Authored_Definition.json", definition_raw)
        course.keep("Browser_Authored_Definition.json", browser_raw)
        course.json("Original_Application_Inventory.json", source)
        if course.state["complete"]:
            course.verify()
            print(json.dumps(course.state["completion"], ensure_ascii=False))
            return
        api = original.NativeHTTP(origin, token, args.timeout_seconds)
        state = api.get("/api/state", workspace=args.workspace, compact="true")
        require(state["workspace_key"] == args.workspace, "Original operator selected another Workspace.")
        project_id = state["data"]["project"]["id"]
        selected = api.get("/api/economic-cost-ranges/source", workspace=args.workspace, id=definition["edition_id"])
        require(selected["workspace_key"] == args.workspace and selected["source"]["edition_sha256"] == definition["edition_sha256"]
                and selected["source"]["report"]["project"]["id"] == project_id,
                "The authored definition belongs to another complete original Economic edition.")
        course.json("Original_Economic_Source.json", selected["source"])
        preview = api.post("/api/economic-cost-ranges/preview", {"definition": definition}, args.workspace)
        require(preview["definition"] == definition and preview["workspace_key"] == args.workspace,
                "Preview changed the exact authored original definition.")
        course.json("Original_Range_Preview.json", preview)
        author = browser(course, args, "author", {
            "phase": "author", "operatorUrl": original_url, "workspace": args.workspace,
            "projectId": project_id, "operation": args.operation, "definitionPath": str(root / "Browser_Authored_Definition.json"),
            "previewSha256": preview["preview_sha256"], "sourceSha256": source["sha256"]}, lock.fileno())
        payload = {"definition": definition, "expected_preview_sha256": preview["preview_sha256"]}
        task = queued(course, api, "saved-range", args.workspace, ACTION, payload,
                      args.task_timeout_seconds, request=author["request"],
                      resume_interrupted=args.resume_interrupted_tasks)
        require(task["id"] == author["task_id"] and task["result"]["id"] == author["range_id"]
                == preview["preview_sha256"], "Browser and native original save selected different results.")
        detail = api.get("/api/economic-cost-ranges/detail", workspace=args.workspace, id=author["range_id"])
        require(detail["definition"] == definition and detail["edition_id"] == definition["edition_id"],
                "The saved range definition differs.")
        course.json("Saved_Cost_Ranges.json", stable_result(detail))
        files = saved_files(course, api, detail, "author")
        verify_range_package(root / "author" / "cost-ranges-package.zip", detail["id"])
        require({x["original_file"] for x in author["downloads"]} == {x["path"] for x in detail["files"]}
                and len(author["downloads"]) == len(detail["files"]),
                "The author browser must download every original published file once.")
        for observed in author["downloads"]:
            local = inspect_file(root / "browser" / "author", observed)
            expected = next((x for x in detail["files"] if x["path"] == observed["original_file"]), None)
            require(expected and local.stat().st_size == expected["bytes"] and file_hash(local) == expected["sha256"],
                    "Actual browser attachment differs from the native saved file.")
        backup = queued(course, api, "complete-workspace-backup", args.workspace, "workspace.backup",
                        {"include_intermediates": True}, args.task_timeout_seconds,
                        resume_interrupted=args.resume_interrupted_tasks)
        tickets = backup["_downloads"]
        require(len(tickets) == 1, "The original backup needs one complete Workspace archive.")
        archive_item = download(course, api, tickets[0], "Complete_Economic_Range_Workspace.zip", backup["result"])
        archive = root / archive_item["file"]
        original_manifest = portable.inspect_archive(archive, verify=True)
        require(original_manifest["project"]["id"] == project_id,
                "The complete original Workspace archive names another project.")
        course.json("Complete_Workspace_Manifest.json", original_manifest)
        uploaded = upload(course, api, "workspace-upload", args.workspace, archive)
        receiving = queued(course, api, "cold-workspace-receive", args.workspace, "workspace.restore",
                           {"upload_id": uploaded["id"]}, args.task_timeout_seconds,
                           resume_interrupted=args.resume_interrupted_tasks)
        received = receiving["result"]
        receiving_key = received["workspace_key"]
        require(received["archive_sha256"] == archive_item["sha256"] and receiving_key != args.workspace,
                "The cold receiver did not open this exact complete archive as a receiving Workspace.")
        received_state = api.get("/api/state", workspace=receiving_key, compact="true")
        require(received_state["data"]["project"]["id"] == project_id,
                "Cold receiving changed the original project identity.")
        received_detail = api.get("/api/economic-cost-ranges/detail", workspace=receiving_key, id=detail["id"])
        require(stable_result(received_detail) == stable_result(detail),
                "The full received range result, source identity or report changed.")
        received_source = api.get("/api/economic-cost-ranges/source", workspace=receiving_key, id=definition["edition_id"])
        require(received_source["source"] == selected["source"],
                "The receiver changed the complete original physical/Economic source.")
        course.json("Cold_Received_Cost_Ranges.json", stable_result(received_detail))
        saved_files(course, api, received_detail, "received")
        cold = browser(course, args, "received", {
            "phase": "received", "operatorUrl": original_url, "workspace": receiving_key,
            "projectId": project_id, "operation": args.operation, "rangeId": detail["id"],
            "definitionPath": str(root / "Browser_Authored_Definition.json"),
            "previewSha256": preview["preview_sha256"], "sourceSha256": source["sha256"]}, lock.fileno())
        require({x["original_file"] for x in cold["downloads"]} == {x["path"] for x in received_detail["files"]}
                and len(cold["downloads"]) == len(received_detail["files"]),
                "The receiving browser must download every original published file once.")
        for observed in cold["downloads"]:
            local = inspect_file(root / "browser" / "received", observed)
            expected = next((x for x in received_detail["files"] if x["path"] == observed["original_file"]), None)
            require(expected and local.stat().st_size == expected["bytes"] and file_hash(local) == expected["sha256"],
                    "The receiving browser attachment differs from its original bytes.")
        final = {"schema": SCHEMA, "operation": args.operation, "project_id": project_id,
                 "workspace_key": args.workspace, "receiving_workspace_key": receiving_key,
                 "range_id": detail["id"], "edition_id": definition["edition_id"],
                 "definition_file": binding["definition_file"], "definition_sha256": binding["definition_sha256"],
                 "browser_definition_file": binding["browser_definition_file"],
                 "browser_definition_sha256": binding["browser_definition_sha256"],
                 "source": source, "saved_task_id": task["id"], "accepted_operation_id": task["operation_id"],
                 "original_operation_id": author["request"]["operation_id"], "archive": archive_item,
                 "same_full_physical_and_economic_source": True, "same_full_saved_range": True,
                 "actual_browser_attachment_equality": True, "native_solver_invocations": 0,
                 "producer_viewing_status": "Actual producer OPEN/LOOK/USE remains required for rendered states and each normal-viewer attachment."}
        course.json("Result.json", final)
        for item in source["files"]:
            original_path = member(app, item["file"])
            require(original_path.stat().st_size == item["bytes"] and file_hash(original_path) == item["sha256"],
                    "Selected source changed during original operation.")
            course.keep("application/" + item["file"], original_path.read_bytes())
        course.verify()
        members = sorted(course.state["artifacts"].values(), key=lambda x:x["file"])
        manifest = {"schema": "upstate.economic-cost-ranges-operated-case/v1", "operation": args.operation,
                    "binding": binding, "members": members}
        manifest_raw = encoded(manifest)
        write(root / "Case_Manifest.json", manifest_raw)
        case = root / "Economic_Cost_Ranges_Complete_Case.zip"
        if not case.exists():
            temp = root / ".economic-cost-ranges-case.pending.zip"
            with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive_file:
                for item in members:
                    info = zipfile.ZipInfo(item["file"], (2020,1,1,0,0,0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive_file.writestr(info, inspect_file(root,item).read_bytes())
                manifest_info = zipfile.ZipInfo("Case_Manifest.json", (2020,1,1,0,0,0))
                manifest_info.compress_type = zipfile.ZIP_DEFLATED
                archive_file.writestr(manifest_info, manifest_raw)
            with temp.open("rb") as stream:
                os.fsync(stream.fileno())
            os.link(temp, case)
            temp.unlink()
            directory_sync(root)
        with zipfile.ZipFile(case) as archive_file:
            require(len(archive_file.namelist()) == len(members) + 1
                    and set(archive_file.namelist()) == {x["file"] for x in members} | {"Case_Manifest.json"}
                    and archive_file.read("Case_Manifest.json") == manifest_raw,
                    "The completed original case has different members.")
            for item in members:
                raw = archive_file.read(item["file"])
                require(len(raw) == item["bytes"] and sha(raw) == item["sha256"],
                        "The complete case changed an original member.")
        course.state["completion"] = {**final, "case_archive": descriptor(case, root)}
        course.state["artifacts"]["Economic_Cost_Ranges_Complete_Case.zip"] = descriptor(case, root)
        course.state["complete"] = True
        course.save()
        print(json.dumps(course.state["completion"], ensure_ascii=False))


def inspect_report_archive(argv):
    """Safely reopen literal downloaded package members for the owned real browser."""
    parser = argparse.ArgumentParser(description=inspect_report_archive.__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    archive_path, output = Path(args.archive).resolve(strict=True), Path(args.output).resolve()
    require(file_hash(archive_path) == args.sha256, "The actual downloaded archive changed before opening.")
    output.mkdir(parents=True, exist_ok=True)
    members = []
    with zipfile.ZipFile(archive_path) as package:
        infos = package.infolist()
        names = [item.filename for item in infos]
        require(len(names) == len(set(names)), "The actual archive repeats member paths.")
        for item in infos:
            require(not item.flag_bits & 1 and not stat.S_ISLNK(item.external_attr >> 16),
                    "The actual archive contains encrypted or linked members.")
            name = item.filename[:-1] if item.is_dir() else item.filename
            target = member(output, name)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            raw = package.read(item)
            require(len(raw) == item.file_size, "The actual archive member size changed.")
            write(target, raw)
            members.append(descriptor(target, output))
    require(any(item["file"] == "index.html" for item in members),
            "The complete original report archive has no actual index.html.")
    manifest = {"schema": "upstate.original-report-archive-inspection/v1",
                "archive": descriptor(archive_path), "members": sorted(members, key=lambda x:x["file"])}
    write(output / "Archive_Opened_Members.json", encoded(manifest))
    print(json.dumps(manifest, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--inspect-report-archive":
        inspect_report_archive(sys.argv[2:])
    else:
        main()

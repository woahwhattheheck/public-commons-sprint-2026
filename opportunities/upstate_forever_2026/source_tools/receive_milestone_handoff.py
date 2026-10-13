#!/usr/bin/env python3
"""Operate the milestone handoff on an existing real Eco operator and Workspace.

Prepare first. A later --response / --handback resumes the same original case;
neither future recipient decisions nor commercial acceptance are invented.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def identity(path):
    path = Path(path)
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return {"bytes": path.stat().st_size, "sha256": h.hexdigest()}


def disjoint(left, right):
    return left != right and not left.is_relative_to(right) and not right.is_relative_to(left)


class Course:
    def __init__(self, args, original):
        self.args, self.native = args, original
        self.root = Path(args.output).resolve()
        self.app, self.workspace = Path(args.app).resolve(strict=True), Path(args.workspace).resolve(strict=True)
        if not disjoint(self.root, self.app) or not disjoint(self.root, self.workspace):
            raise ValueError("Keep course output outside the original application and scientific Workspace")
        self.root.mkdir(parents=True, exist_ok=True)
        self.state_path = self.root / "course.json"
        self.state = original["read_json"](self.state_path) if self.state_path.exists() else {"schema": "upstate.milestone-course/v1", "steps": {}, "stages": {}}
        self.secret = Path(args.capability_file).read_text(encoding="utf-8").strip()
        if not self.secret:
            raise ValueError("Read the existing original operator capability from its private file")
        parsed = urllib.parse.urlsplit(args.operator_url)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Choose the actual original operator base URL without credentials or query")
        self.base = args.operator_url.rstrip("/")
        self.stop = False
        self.child = None

    def checkpoint(self):
        self.native["atomic_json"](self.state_path, self.state)

    def keep(self, relative, raw):
        path = self.root / relative
        self.native["atomic_bytes"](path, raw, immutable=True)
        return {"file": relative, **identity(path)}

    def keep_json(self, relative, value):
        return self.keep(relative, self.native["canonical"](value) + b"\n")

    def read(self, route, value=None):
        if self.stop:
            raise KeyboardInterrupt
        url = self.base + route
        headers = {"Authorization": "Bearer " + self.secret, "X-Workspace": self.args.workspace_key}
        if value is None:
            request = urllib.request.Request(url, headers=headers)
        else:
            headers["Content-Type"] = "application/json"
            request = urllib.request.Request(url, data=self.native["canonical"](value), headers=headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
        return json.loads(raw)

    def get(self, route, **args):
        return self.read(route + "?" + urllib.parse.urlencode({"workspace": self.args.workspace_key, **args}))

    def raw(self, url):
        resolved = urllib.parse.urljoin(self.base + "/", url)
        if urllib.parse.urlsplit(resolved)[:2] != urllib.parse.urlsplit(self.base)[:2]:
            raise ValueError("Original download ticket leaves the selected operator")
        request = urllib.request.Request(resolved, headers={
            "Authorization": "Bearer " + self.secret, "X-Workspace": self.args.workspace_key})
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()

    def task(self, name, action, payload):
        relative = "requests/" + name + ".json"
        path = self.root / relative
        proposed = {"workspace": self.args.workspace_key, "action": action, "payload": payload,
                    "operation_id": self.args.operation + "-" + name}
        if len(proposed["operation_id"]) > 100:
            proposed["operation_id"] = "milestone-" + self.native["digest"]([self.args.operation, name])[:64]
        self.keep_json(relative, proposed)
        request = self.native["read_json"](path)
        expected_hash = self.native["digest"]({key: request[key] for key in ("workspace", "action", "payload")})
        accepted = self.state["steps"].get(name, {}).get("id")

        def retain(task):
            nonlocal accepted
            if (task.get("workspace") != request["workspace"] or task.get("action") != action
                    or task.get("payload") != payload or task.get("request_sha256") != expected_hash
                    or not isinstance(task.get("id"), str) or (accepted is not None and task["id"] != accepted)):
                raise ValueError("The original task returned another request or accepted task identity")
            # Original Operator may alias this requested operation to an already
            # active task with the SAME exact request hash. Keep both identities.
            accepted = task["id"]
            self.state["steps"][name] = task
            self.checkpoint()
            self.keep_json("accepted/" + name + ".json", {
                "requested_operation_id": request["operation_id"], "task_id": accepted,
                "task_operation_id": task["operation_id"], "request_sha256": expected_hash})
            return task

        if accepted is None:
            retain(self.read("/api/actions", request))
        # POST and resume return raw tasks. Only task_view supplies the current
        # original verified downloads and recipient-desk descriptor.
        task = retain(self.get("/api/task", id=accepted))
        while True:
            if task["state"] == "complete":
                return task
            if task["state"] in ("failed", "cancelled", "interrupted"):
                if not self.args.resume_task:
                    raise ValueError("Original task " + task["id"] + " is " + task["state"] +
                                     ". Inspect its retained error; --resume-task resumes this SAME task after repair.")
                retain(self.read("/api/task/resume", {"id": accepted}))
                self.args.resume_task = False
                task = retain(self.get("/api/task", id=accepted))
                continue
            if self.stop:
                raise KeyboardInterrupt
            time.sleep(.5)
            task = retain(self.get("/api/task", id=accepted))

    def download(self, prefix, ticket):
        name = ticket["filename"]
        if Path(name).name != name:
            raise ValueError("Original download name is not a simple file name")
        relative = prefix + "/" + name
        path = self.root / relative
        wanted = {"bytes": ticket["bytes"], "sha256": ticket["sha256"]}
        if path.exists():
            if identity(path) != wanted:
                raise ValueError("The retained original download differs: " + name)
            return {"file": relative, **wanted}
        raw = self.raw(ticket["url"])
        if len(raw) != wanted["bytes"] or sha(raw) != wanted["sha256"]:
            raise ValueError("The actual HTTP download differs from the original file ticket")
        return self.keep(relative, raw)

    def same_completed_stage(self, stage):
        completed = self.state["stages"].get(stage)
        if not completed:
            return None
        for row in completed["outputs"]:
            if identity(self.root / row["file"]) != {k: row[k] for k in ("bytes", "sha256")}:
                raise ValueError("A completed original stage artifact changed: " + row["file"])
        manifest = self.native["read_json"](self.root / completed["case_manifest"])
        with zipfile.ZipFile(self.root / completed["case_archive"]) as archive:
            if set(archive.namelist()) != set(manifest["members"]):
                raise ValueError("Completed case member inventory changed")
            for name, item in manifest["members"].items():
                raw = archive.read(name)
                if len(raw) != item["bytes"] or sha(raw) != item["sha256"]:
                    raise ValueError("Completed original case member changed: " + name)
        return completed

    def browser(self, config, phase):
        folder = self.root / "browser" / phase
        folder.mkdir(parents=True, exist_ok=True)
        config_path = folder / "Browser_Continuation.json"
        self.native["atomic_json"](config_path, config, immutable=True)
        result_path = folder / "result.json"
        if result_path.exists():
            result = self.native["read_json"](result_path)
            if result.get("binding") != self.native["digest"](config) or result.get("closed") is not True:
                raise ValueError("Reconcile the original unfinished browser operation before retry")
            for row in result["artifacts"]:
                if identity(folder / row["file"]) != {k: row[k] for k in ("bytes", "sha256")}:
                    raise ValueError("A completed browser artifact changed")
            return result
        child_path = folder / "child.json"
        if child_path.exists():
            old = self.native["read_json"](child_path)
            stat_path = Path("/proc") / str(old["pid"]) / "stat"
            if stat_path.exists() and stat_path.read_text().split(") ", 1)[1].split()[19] == old["start_ticks"]:
                raise ValueError("The original browser process is still alive; retain its original course")
        script = self.app / "source_tools/receive_milestone_handoff_browser.mjs"
        command = [self.args.node, str(script), "--config", str(config_path),
                   "--playwright", self.args.playwright, "--browser", self.args.browser_executable]
        with (folder / "browser.log").open("ab") as log:
            self.child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                          pass_fds=(self.lock_fd,), start_new_session=True)
            stat_path = Path("/proc") / str(self.child.pid) / "stat"
            ticks = stat_path.read_text().split(") ", 1)[1].split()[19] if stat_path.exists() else "ended-before-pid-read"
            self.native["atomic_json"](child_path, {"pid": self.child.pid, "start_ticks": ticks, "command": command})
            try:
                while self.child.poll() is None:
                    if self.stop:
                        self.child.terminate()
                    time.sleep(.3)
                if self.child.returncode:
                    raise ValueError("Original browser ended with status " + str(self.child.returncode) +
                                     "; inspect browser.log and preserve its working files")
            finally:
                if self.child.poll() is None:
                    self.child.terminate()
                    self.child.wait()
                self.child = None
        result = self.native["read_json"](result_path)
        if result.get("closed") is not True or result.get("binding") != self.native["digest"](config):
            raise ValueError("Browser has not confirmed its original closed result")
        return result

    def package(self, stage, result, outputs):
        folder = self.root / stage
        manifest_path, archive_path = folder / "Complete_Case_Manifest.json", folder / "Complete_Milestone_Case.zip"
        members = {}
        selected = [self.root / row["file"] for row in outputs]
        selected += sorted((self.root / "inputs").glob("*")) + sorted((self.root / "requests").glob("*"))
        selected += sorted((self.root / "accepted").glob("*"))
        selected += [folder / "result.json"]
        for path in selected:
            if path.is_file():
                members[path.relative_to(self.root).as_posix()] = identity(path)
        manifest = {"schema": "upstate.milestone-course-case/v1", "binding": self.state["binding"],
                    "stage": stage, "members": members}
        self.native["atomic_json"](manifest_path, manifest, immutable=True)
        if archive_path.exists():
            with zipfile.ZipFile(archive_path) as archive:
                if set(archive.namelist()) != set(members):
                    raise ValueError("Retained complete case has another inventory")
                for name, item in members.items():
                    raw = archive.read(name)
                    if len(raw) != item["bytes"] or sha(raw) != item["sha256"]:
                        raise ValueError("Retained complete case member changed")
        else:
            temporary = folder / ".complete-case.pending"
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for name in sorted(members):
                    archive.write(self.root / name, name)
            os.replace(temporary, archive_path)
        return {"case_manifest": manifest_path.relative_to(self.root).as_posix(),
                "case_archive": archive_path.relative_to(self.root).as_posix(),
                "outputs": [*outputs, {"file": manifest_path.relative_to(self.root).as_posix(), **identity(manifest_path)},
                            {"file": archive_path.relative_to(self.root).as_posix(), **identity(archive_path)}], "result": result}

    def run(self):
        ws = self.native["Workspace"](self.workspace)
        authored = Path(self.args.definition).read_bytes()
        d = json.loads(authored)
        selected = self.get("/api/state")
        if selected["data"]["project"] != ws.project or selected["workspace_key"] != self.args.workspace_key:
            raise ValueError("The real operator and selected native Workspace differ")
        source_files = {path.relative_to(self.app).as_posix(): identity(path)
                        for path in self.native["portable"]._application(self.app)}
        binding = {"schema": "upstate.milestone-course-binding/v1", "operation": self.args.operation,
                   "operator": self.base, "workspace_key": self.args.workspace_key, "project": ws.project,
                   "definition": {"bytes": len(authored), "sha256": sha(authored)},
                   "source": source_files, "browser": bool(self.args.browser)}
        if self.state.get("binding") not in (None, binding):
            raise ValueError("Resume this case with its exact original source, definition, operator and browser mode")
        self.state["binding"] = binding
        self.checkpoint()
        self.keep("inputs/Original_Authored_Definition.json", authored)
        self.keep_json("inputs/Original_Application_Source.json", source_files)
        # Original preview is retained once; later phases replay its original body.
        preview_path = self.root / "inputs/Original_Preview.json"
        if preview_path.exists():
            preview = self.native["read_json"](preview_path)
        else:
            preview = self.read("/api/milestone-handoff/preview", {"workspace": self.args.workspace_key, "definition": d})
            self.keep_json("inputs/Original_Preview.json", preview)
        if preview["definition"] != d or preview["project"] != ws.project:
            raise ValueError("Use the normalized actual preview definition and original project")
        task = self.task("create", "milestone-handoff.create",
                         {"definition": d, "preview_sha256": preview["preview_sha256"]})
        review_id = task["result"]["review_id"]
        raw_response = Path(self.args.response).read_bytes() if self.args.response else None
        raw_handback = Path(self.args.handback).read_bytes() if self.args.handback else None
        if raw_handback and not raw_response:
            raise ValueError("Select the actual returned response associated with this engineering handback")
        stage = "prepared" if raw_response is None else "returned-" + sha(raw_response)[:16] + (
            "-handback-" + sha(raw_handback)[:12] if raw_handback else "")
        complete = self.same_completed_stage(stage)
        if complete:
            return complete["result"]
        response_id = None
        if raw_response is not None:
            self.keep("inputs/Response_" + sha(raw_response) + ".json", raw_response)
            returned = json.loads(raw_response)
            if returned.get("review_id") != review_id or returned.get("project_id") != ws.project["id"]:
                raise ValueError("The actual returned response names another original review")
            response_task = self.task("response-" + sha(raw_response)[:16], "customer.review.response.import",
                                      {"review_id": review_id, "response": returned})
            response_id = response_task["result"]["response_id"]
        if raw_handback is not None:
            self.keep("inputs/Handback_" + sha(raw_handback) + ".json", raw_handback)
            handback = json.loads(raw_handback)
            if handback.get("review_id") != review_id or handback.get("response_id") != response_id:
                raise ValueError("The actual engineering handback names another original response")
            self.task("handback-" + sha(raw_handback)[:16], "customer.review.handback.save", {"handback": handback})
        detail = self.get("/api/milestone-handoff/detail", id=review_id, response_id=response_id or "")
        native = self.native["engine"].snapshot(ws, review_id, response_id)
        for key, value in native.items():
            if detail.get(key) != value:
                raise ValueError("Actual operator and original native milestone differ: " + key)
        export_task = self.task(stage + "-export", "customer.review.export",
                               {"review_id": review_id, "expected_response_id": response_id})
        outputs = [self.download(stage + "/evidence", ticket) for ticket in detail["_downloads"]]
        outputs += [self.download(stage + "/review", ticket) for ticket in export_task["_downloads"]]
        archive = next(self.root / row["file"] for row in outputs if row["file"].endswith("/review-desk.zip"))
        packet = self.native["reviews"].inspect_packet(archive)
        if packet["packet"]["review"] != self.native["reviews"].show_review(ws, review_id)["review"]:
            # show_review adds preview to files; compare original stored record below.
            received_review = copy_without_previews(packet["packet"]["review"])
            if received_review != ws._get("reviews", review_id):
                raise ValueError("The actual review archive changed the complete original record")
        self.keep_json(stage + "/Pinned_Milestone_Snapshot.json", native)
        outputs.append({"file": stage + "/Pinned_Milestone_Snapshot.json", **identity(self.root / stage / "Pinned_Milestone_Snapshot.json")})
        phase_dir = self.root / stage
        full = phase_dir / "Complete_Scientific_Project.zip"
        if full.exists():
            manifest = self.native["portable"].inspect_archive(full)
            if manifest["project"] != ws.project:
                raise ValueError("Retained working archive belongs to another project")
        else:
            self.native["portable"].backup(ws, full)
        outputs.append({"file": full.relative_to(self.root).as_posix(), **identity(full)})
        cold = phase_dir / "cold-received"
        if cold.exists():
            receiving = self.native["portable"].resume_restore(full, cold, expected_archive_sha256=identity(full)["sha256"])
        else:
            receiving = self.native["portable"].restore(full, cold)
        received_ws = self.native["Workspace"](cold / "workspace")
        # Operator restore calls the registered verifier; direct native receiving
        # performs the same complete retained-profile check explicitly here.
        verified = self.native["engine"].catalogue(received_ws)
        if verified["issues"]:
            raise ValueError("Received milestone binding failed: " + str(verified["issues"]))
        received = self.native["engine"].snapshot(received_ws, review_id, response_id)
        if received != native:
            raise ValueError("Cold receiving changed the original milestone, response or handback history")
        stable_receiving = {key: value for key, value in receiving.items()
                            if key != "reused_completed_output"}
        self.keep_json(stage + "/Cold_Receiving.json", {"receiving": stable_receiving, "milestones": verified,
                                                      "same_complete_original_snapshot": True})
        outputs.append({"file": stage + "/Cold_Receiving.json", **identity(self.root / stage / "Cold_Receiving.json")})
        browser_result = None
        if self.args.browser:
            working = {"schema": "upstate.milestone-handoff-working/v1",
                "id": "course-" + self.native["digest"]([self.args.operation, stage])[:24],
                "scope": {"workspace_key": self.args.workspace_key, "project_id": ws.project["id"],
                          "owner": json.dumps({"id": selected["person"].get("id"), "name": selected["person"].get("name")},
                                             sort_keys=True, separators=(",", ":"), ensure_ascii=False)},
                "updated_at": task["created_at"], "definition": d, "history": [], "origin": None,
                "pending": {"request": self.native["read_json"](self.root / "requests/create.json"),
                            "request_sha256": self.native["digest"](self.native["read_json"](self.root / "requests/create.json")),
                            "task_id": None, "state": "prepared", "rejected": None}}
            self.keep_json(stage + "/Original_Working_Request.json", working)
            browser_config = {"schema": "upstate.milestone-browser-course/v1", "operator_url": self.base,
                "workspace_key": self.args.workspace_key, "project_id": ws.project["id"], "review_id": review_id,
                "response_id": response_id, "definition": d,
                "working_file": str(self.root / stage / "Original_Working_Request.json"),
                "capability_file": str(Path(self.args.capability_file).resolve()),
                "downloads": outputs, "root": str(self.root), "desk_url": export_task["_review"]["desk_url"],
                "output": str(self.root / "browser" / stage)}
            browser_result = self.browser(browser_config, stage)
            outputs += [{"file": "browser/" + stage + "/" + row["file"], "bytes": row["bytes"], "sha256": row["sha256"]}
                        for row in browser_result["artifacts"]]
        result = {"schema": "upstate.milestone-course-result/v1", "operation": self.args.operation, "stage": stage,
            "project": ws.project, "workspace_key": self.args.workspace_key, "review_id": review_id,
            "response_id": response_id, "definition_sha256": self.native["digest"](d),
            "definition_file_sha256": sha(authored), "preview_sha256": preview["preview_sha256"],
            "source_sha256": self.native["digest"](source_files), "original_review_export_task": export_task["id"],
            "milestone": native["milestone"], "summary": native["summary"], "same_cold_snapshot": True,
            "browser": browser_result, "visual_status": "Actual artifacts require the producing operator to VIEW the retained screenshots and files." if browser_result else "Not operated in browser in this stage.",
            "commercial_status": "No contract, confidentiality agreement, invoice, payment or customer acceptance was executed by this course."}
        self.keep_json(stage + "/result.json", result)
        complete = self.package(stage, result, outputs)
        self.state["stages"][stage] = complete
        self.checkpoint()
        return result


def copy_without_previews(value):
    result = json.loads(json.dumps(value))
    for row in result["artifacts"]:
        row.pop("preview", None)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "workspace", "workspace-key", "operator-url", "capability-file", "definition", "output", "operation"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--response")
    parser.add_argument("--handback")
    parser.add_argument("--resume-task", action="store_true")
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--node")
    parser.add_argument("--playwright")
    parser.add_argument("--browser-executable")
    args = parser.parse_args()
    if args.browser and not all((args.node, args.playwright, args.browser_executable)):
        parser.error("Browser operation uses the existing --node, --playwright and --browser-executable")
    sys.path[:0] = [str(Path(args.app).resolve()), str(Path(args.app).resolve() / "operator")]
    from model import milestone_handoff, portable, reviews
    from model.workspace import Workspace
    from model.common import atomic_json, atomic_bytes, canonical, digest, read_json
    native = dict(engine=milestone_handoff, portable=portable, reviews=reviews, Workspace=Workspace,
                  atomic_json=atomic_json, atomic_bytes=atomic_bytes, canonical=canonical, digest=digest, read_json=read_json)
    course = Course(args, native)
    import fcntl
    with (course.root / "course.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        course.lock_fd = lock.fileno()
        def stop(signum, frame):
            course.stop = True
            if course.child is not None and course.child.poll() is None:
                course.child.terminate()
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, stop)
        result = course.run()
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

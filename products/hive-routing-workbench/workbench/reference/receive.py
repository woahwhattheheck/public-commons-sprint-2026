#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run the original four-subgraph Hive reference through the existing operator.

One reference lifetime selects the original fixture binary, three native router
attempts and the unchanged twenty operations per phase. Actual HTTP bodies,
errors, extensions, source editions, decisions and portable receiving are kept.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

from .build_fixture import validate_ready, write_json
from .prepare import (UPSTREAM_COMMIT, REFERENCE, SUBGRAPHS, encoded, identity,
                      no_symlinks, prepare, publish, read_stable, relative)

OPERATION = "HIVE-APPLICATION-MIGRATION-0C7A-20261012"
PHASES = ("initial", "changed", "rollback")
NEGATIVE = {"unknown-field", "missing-variable", "invalid-variable"}


def need(value, message):
    if not value:
        raise ValueError(message)


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def file_identity(path):
    info = Path(path).stat()
    return identity(read_stable(Path(path), info.st_size))


def request_json(url, timeout=3):
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def source_inventory(source):
    raw = read_stable(source / "source-files.json", 16 * 1024 * 1024)
    selected = json.loads(raw)
    names = selected.get("files")
    need(isinstance(names, list) and names and all(isinstance(n, str) for n in names),
         "Select the complete installed source-files.json from the same Hive product")
    need(len(names) == len(set(names)), "Complete product source paths must be unique")
    rows = [{"path": name, **file_identity(relative(source, name))} for name in sorted(names)]
    return {"manifest": identity(raw), "files": rows}


class Fixture:
    """Retain the actual original fixture child and its inherited lifetime lease."""
    def __init__(self, root, binary, upstream, port, input_sha):
        from hive_desk.util import process_identity, same_process
        self.process_identity, self.same_process = process_identity, same_process
        self.root, self.binary, self.upstream = root, Path(binary).absolute(), upstream
        self.port, self.input_sha = port, input_sha
        self.lock_path = root / "fixture.lock"
        self.record = root / "fixture-owner.json"
        self.fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        self.child = None
        self.owner = None
        self.log = None

    def matches(self, pid):
        observed = self.process_identity(pid)
        if not observed or observed["executable"] != str(self.binary.resolve(strict=True)):
            return None
        proc = Path("/proc") / str(pid)
        try:
            if Path(os.readlink(proc / "cwd")).resolve() != self.upstream.resolve():
                return None
            env = dict(part.split(b"=", 1) for part in (proc / "environ").read_bytes().split(b"\0") if b"=" in part)
            expected = {b"HIVE_REFERENCE_OPERATION": OPERATION.encode(),
                        b"HIVE_REFERENCE_INPUT_SHA256": self.input_sha.encode(),
                        b"HOST": b"127.0.0.1", b"PORT": str(self.port).encode()}
            if any(env.get(k) != v for k, v in expected.items()):
                return None
            own = os.fstat(self.fd)
            if not any((s.st_dev, s.st_ino) == (own.st_dev, own.st_ino)
                       for s in self.fd_stats(proc / "fd")):
                return None
        except (OSError, ValueError):
            return None
        return observed

    @staticmethod
    def fd_stats(directory):
        for path in directory.iterdir():
            try:
                yield path.stat()
            except OSError:
                continue

    def existing_owner(self):
        owners = []
        for directory in Path("/proc").iterdir():
            if directory.name.isdecimal():
                found = self.matches(int(directory.name))
                if found:
                    owners.append(found)
        need(len(owners) <= 1, "More than one original fixture holds this operation's selected lease")
        return owners[0] if owners else None

    def recover_for_close(self, expected_owner=None):
        """Reconcile a finished programme's fixture without starting a process."""
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError:
            acquired = False
        if not acquired:
            self.owner = self.existing_owner()
            need(self.owner, "The completed programme's original fixture lease is still held")
            need(not expected_owner or self.owner == expected_owner,
                 "The retained fixture owner differs from the completed programme")
        else:
            prior = json.loads(read_stable(self.record, 1024 * 1024)) if self.record.exists() else None
            if prior:
                need(prior.get("operation_id") == OPERATION
                     and prior.get("input_sha256") == self.input_sha
                     and prior.get("argv") == [str(self.binary)]
                     and prior.get("cwd") == str(self.upstream)
                     and prior.get("port") == self.port,
                     "The retained fixture close record selects a different original input")
            retained_owner = expected_owner or (prior.get("owner") if prior else None)
            need(not self.same_process(retained_owner),
                 "The retained fixture is alive without its original lease; reconcile that same process")
            self.owner = retained_owner
        return self.owner

    def start(self):
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError:
            acquired = False
        if not acquired:
            self.owner = self.existing_owner()
            need(self.owner, "The original fixture lease is held; retain and reconcile that same owner")
        else:
            prior = json.loads(read_stable(self.record, 1024 * 1024)) if self.record.exists() else None
            need(not prior or not self.same_process(prior.get("owner")),
                 "The prior fixture owner is still alive")
            environment = dict(os.environ, HOST="127.0.0.1", PORT=str(self.port),
                HIVE_REFERENCE_OPERATION=OPERATION, HIVE_REFERENCE_INPUT_SHA256=self.input_sha)
            intent = {"schema": "hive-desk-reference-fixture-owner/v1",
                "operation_id": OPERATION, "input_sha256": self.input_sha,
                "argv": [str(self.binary)], "cwd": str(self.upstream),
                "port": self.port, "state": "prepared", "owner": None}
            write_json(self.record, intent)
            self.log = (self.root / "fixture.log").open("ab")
            try:
                self.child = subprocess.Popen([str(self.binary)], cwd=self.upstream,
                    env=environment, stdin=subprocess.DEVNULL, stdout=self.log,
                    stderr=subprocess.STDOUT, pass_fds=(self.fd,))
                self.owner = self.process_identity(self.child.pid)
                need(self.owner, "The original fixture ended before its owner was recorded")
                write_json(self.record, {**intent, "state": "running", "owner": self.owner})
            except BaseException:
                if self.child is not None and self.child.poll() is None:
                    self.child.terminate(); self.child.wait(timeout=30)
                if self.log is not None:
                    self.log.flush(); os.fsync(self.log.fileno()); self.log.close(); self.log = None
                raise
        # Recovery checks the original lease inode, binary, cwd and operation
        # environment, so a queued-before-owner receipt can adopt that same child.
        need(self.matches(self.owner["pid"]) == self.owner,
             "Original fixture identity differs from its exact retained selection")
        deadline = time.monotonic() + 45
        last = None
        while time.monotonic() < deadline:
            need(self.same_process(self.owner), "The original fixture stopped before readiness")
            try:
                code, body = request_json("http://127.0.0.1:%d/health" % self.port)
                last = {"status": code, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                if code == 200:
                    return {"owner": self.owner, "health": last,
                            "base_url": "http://127.0.0.1:%d" % self.port}
            except OSError as error:
                last = {"error": str(error)}
            time.sleep(0.1)
        raise RuntimeError("Original fixture did not become ready: " + json.dumps(last))

    def close(self):
        if self.owner and self.same_process(self.owner):
            need(self.matches(self.owner["pid"]) == self.owner, "Refuse to stop a different fixture process")
            os.kill(self.owner["pid"], signal.SIGTERM)
            deadline = time.monotonic() + 40
            while self.same_process(self.owner) and time.monotonic() < deadline:
                time.sleep(0.1)
            need(not self.same_process(self.owner), "Original fixture is still draining; retain its owner")
        if self.child is not None:
            self.child.wait(timeout=1)
        if self.log is not None:
            self.log.flush(); os.fsync(self.log.fileno()); self.log.close(); self.log = None
        if self.fd is not None:
            os.close(self.fd); self.fd = None
        if self.owner:
            write_json(self.record, {"schema": "hive-desk-reference-fixture-owner/v1",
                "operation_id": OPERATION, "input_sha256": self.input_sha,
                "argv": [str(self.binary)], "cwd": str(self.upstream), "port": self.port,
                "state": "closed", "owner": self.owner, "closed_at": time.time()})


def validate_programme(workspace, run, phase):
    from hive_desk import programme
    rows = run["data"]["rows"]
    selected = json.loads(read_stable(REFERENCE / "operations.json", 1024 * 1024))["operations"]
    need(run["data"]["state"] == "complete" and len(rows) == 20
         and [row["id"] for row in rows] == [row["id"] for row in selected],
         "Retain a complete native twenty-operation programme before review")
    parsed, evidence = {}, []
    for row in rows:
        need(row["state"] == "received" and row.get("response"), "Original HTTP response is missing")
        raw = programme.response_body(workspace, run["id"], row["id"])
        need(file_bytes_identity(raw) == row["response"]["body"], "Original native body identity differs")
        value = json.loads(raw)
        need(isinstance(value, dict), "Original GraphQL response must be an object")
        error_expected = row["id"] in NEGATIVE or (row["id"] == "reviewed-schema-surface" and phase == "changed")
        if error_expected:
            need(isinstance(value.get("errors"), list) and value["errors"],
                 "The selected negative/reference-change request did not retain its native errors")
        else:
            need(row["response"]["status"] == 200 and not value.get("errors") and isinstance(value.get("data"), dict),
                 "The selected original query returned an unexpected native error: " + row["id"])
        parsed[row["id"]] = value
        evidence.append({"id": row["id"], "status": row["response"]["status"],
                         "body": row["response"]["body"],
                         "graphql_keys": sorted(value), "expected_error": error_expected})
    products = parsed["catalogue-complete"]["data"]["topProducts"]
    inventory = parsed["inventory-complete"]["data"]["topProducts"]
    accounts = parsed["accounts-complete"]["data"]["users"]
    reviews = [review for product in parsed["product-review-authors"]["data"]["topProducts"]
               for review in product["reviews"]]
    need([p["upc"] for p in products] == [str(n) for n in range(1, 10)]
         and len(inventory) == 9, "The complete original nine-product population was not returned")
    need([a["id"] for a in accounts] == [str(n) for n in range(1, 7)],
         "The complete original six-account population was not returned")
    need(sorted(int(r["id"]) for r in reviews) == list(range(1, 12)),
         "The complete original eleven-review population was not returned")
    need(parsed["missing-account"]["data"]["user"] is None, "Original absent-account result differs")
    need(len(parsed["default-products"]["data"]["topProducts"]) == 5
         and len(parsed["limited-products"]["data"]["topProducts"]) == 1
         and len(parsed["graphql-get"]["data"]["topProducts"]) == 2,
         "Original defaults, variables or GET selection differs")
    need(all("reviews" not in p for p in parsed["conditional-exclusion"]["data"]["topProducts"])
         and all("reviews" in p for p in parsed["conditional-inclusion"]["data"]["topProducts"]),
         "Original conditional selection differs")
    if phase != "changed":
        need(len(parsed["reviewed-schema-surface"]["data"]["topProducts"]) == 9
             and all(isinstance(p.get("internal"), str) for p in parsed["reviewed-schema-surface"]["data"]["topProducts"]),
             "Original Product.internal result is incomplete")
    return {"phase": phase, "programme_id": run["id"], "programme_revision": run["revision"],
            "native_attempt": run["data"]["nativeAttempt"], "responses": evidence,
            "populations": {"products": len(products), "inventory": len(inventory),
                            "accounts": len(accounts), "reviews": len(reviews)}}, parsed


def file_bytes_identity(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def stop_router(workspace, deployment_id):
    from hive_desk import native
    original = native.status(workspace, deployment_id, probes=False)
    if original["observation"].get("nativeAlive"):
        native.stop(workspace, deployment_id)
    deadline = time.monotonic() + 65
    while time.monotonic() < deadline:
        value = native.status(workspace, deployment_id)
        observed = value["observation"]
        if not observed.get("nativeAlive") and not observed.get("supervisorAlive"):
            native.reconcile(workspace, deployment_id)
            return native.status(workspace, deployment_id)
        time.sleep(0.1)
    raise RuntimeError("Original native router is still draining: " + deployment_id)


def ensure_configuration_review(workspace, edition, phase):
    from hive_desk.editions import save_review
    decisions = [{"feature": row["feature"], "decision": "changed" if phase == "changed" else "retain",
                  "reason": ("Explicit loopback runtime realization and reviewed Product.internal removal."
                             if phase == "changed" else "Original source retained; explicit loopback listener and native subgraph ports.")}
                 for row in edition["data"]["features"]]
    note = "Complete source-native reference configuration; original public fixture, no customer data."
    existing = workspace.get("configuration-review", edition["id"])
    if existing:
        need(existing["data"]["editionRevision"] == edition["revision"]
             and existing["data"]["decisions"] == decisions and existing["data"]["note"] == note,
             "A different retained configuration review requires its original operator")
        return existing
    return save_review(workspace, edition["id"], decisions, note)


def ensure_programme_review(workspace, run, validation):
    from hive_desk import programme
    decisions = [{"id": row["id"], "decision": "accept",
                  "reason": ("Retained complete native error for the explicitly selected validation/change case."
                             if row["expected_error"] else "Original complete query result and source population received.")
                            + " HTTP %s; body SHA256 %s." % (row["status"], row["body"]["sha256"])}
                 for row in validation["responses"]]
    note = "Reviewed every actual original request/response; full data, errors and extensions remain retained."
    existing = workspace.get("programme-review", run["id"])
    if existing:
        need(existing["data"]["programmeRevision"] == run["revision"]
             and existing["data"]["decisions"] == decisions and existing["data"]["note"] == note,
             "A different retained native programme review requires its original operator")
        return existing
    return programme.review(workspace, run["id"], decisions, note)


def export_once(workspace, destination, source, ledger, key, save):
    from hive_desk.workspace import inspect_archive
    snapshot = workspace.verify()
    wanted = {"workspace_id": snapshot["id"], "revision": snapshot["revision"],
              "path": str(destination), "source_inventory": ledger["input"]["product_source"]}
    if key not in ledger["exports"]:
        ledger["exports"][key] = {"selection": wanted}; save()
    selection = ledger["exports"][key]["selection"]
    need(selection == wanted, "Named original export belongs to a different workspace/source revision")
    if not destination.exists():
        workspace.export(destination, source)
    inspected = inspect_archive(destination)
    need(inspected["manifest"]["workspaceId"] == snapshot["id"]
         and inspected["manifest"]["revision"] == snapshot["revision"],
         "Named original export differs from its retained selection")
    for row in ledger["input"]["product_source"]["files"]:
        item = next((x for x in inspected["manifest"]["members"] if x["path"] == "source/" + row["path"]), None)
        need(item and item["bytes"] == row["bytes"] and item["sha256"] == row["sha256"],
             "Original portable product source is missing or changed: " + row["path"])
    result = {"path": str(destination), "bytes": inspected["bytes"], "sha256": inspected["sha256"],
              "workspace_id": snapshot["id"], "revision": snapshot["revision"]}
    previous = ledger["exports"][key].get("result")
    need(previous is None or previous == result, "Sealed named export changed")
    ledger["exports"][key]["result"] = result; save()
    return result


def receive_once(archive, destination):
    from hive_desk.workspace import Workspace, inspect_archive, receive_archive
    expected = inspect_archive(archive)
    if not destination.exists():
        receive_archive(archive, destination)
    with Workspace(destination / "workspace") as restored:
        observed = restored.verify()
        need(observed["id"] == expected["manifest"]["workspaceId"]
             and observed["revision"] == expected["manifest"]["revision"],
             "Reopened receiving workspace differs")
        for row in expected["manifest"]["members"]:
            if row["path"].startswith("source/"):
                body = read_stable(relative(destination, row["path"]), row["bytes"])
                need(file_bytes_identity(body) == {"bytes": row["bytes"], "sha256": row["sha256"]},
                     "Reopened complete product source differs")
        return {"path": str(destination), "archive": {"bytes": expected["bytes"], "sha256": expected["sha256"]},
                "workspace": observed}


def execute(args):
    from hive_desk.workspace import Workspace, compare_receiving
    from hive_desk.editions import import_edition
    from hive_desk import native, programme, deployment
    source, upstream, root = map(lambda p: Path(p).absolute(), (args.source, args.upstream, args.root))
    for path in (source, upstream, root):
        no_symlinks(path)
    need(Path(native.__file__).resolve().parent.parent == source.resolve(),
         "The executing Hive operator must be the selected complete product source")
    no_symlinks(source / "reference")
    no_symlinks(source / "reference" / "receive.py")
    need(Path(__file__).resolve() == (source / "reference" / "receive.py").resolve()
         and REFERENCE == (source / "reference").resolve(),
         "The executing reference and preparer must belong to the selected complete product")
    need(len({args.initial_port, args.changed_port, args.subgraph_port}) == 3
         and all(1024 <= p <= 65535 for p in (args.initial_port, args.changed_port, args.subgraph_port)),
         "Select three distinct explicit unprivileged ports")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = os.open(root / "reference.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    fixture = None
    ws = None
    opened_deployments = []
    ledger = None
    try:
        ready = validate_ready(args.fixture_ready, upstream)
        router = Path(args.router).absolute()
        router_identity = file_identity(router)
        selected_source = source_inventory(source)
        binding = {"operation_id": OPERATION, "source_root": str(source),
            "upstream_root": str(upstream), "root": str(root),
            "product_source": selected_source, "router": {"path": str(router), **router_identity},
            "fixture_ready": file_identity(Path(args.fixture_ready).absolute()),
            "fixture_binary": ready["binary"],
            "ports": {"initial": args.initial_port, "changed": args.changed_port, "subgraphs": args.subgraph_port}}
        journal = root / "reference-receiving.json"
        if journal.exists():
            ledger = json.loads(read_stable(journal, 16 * 1024 * 1024))
            need(ledger["input"] == binding, "Resume the exact original source/runtime/port selection")
            need(args.resume, "Use --resume for this same retained reference programme")
        else:
            ledger = {"schema": "hive-desk-reference-receiving/v1", "operation_id": OPERATION,
                      "input": binding, "created_at": time.time(), "state": "prepared",
                      "phases": {}, "exports": {}, "errors": []}
        def save():
            write_json(journal, ledger)
        save()
        if ledger.get("final_candidate"):
            candidate = ledger["final_candidate"]
            for row in candidate["artifacts"]:
                need(file_identity(Path(row["path"])) == {k: row[k] for k in ("bytes", "sha256", "git_blob")},
                     "A sealed original receiving artifact changed")
            receive_once(Path(candidate["final_archive"]["path"]), root / "receiving-final")
            publish(root / "result.json", encoded(candidate))
            ledger["state"] = "complete"; save()
            return candidate
        prepared = prepare(upstream, root / "editions", initial_port=args.initial_port,
            changed_port=args.changed_port,
            endpoints={name: "http://127.0.0.1:%d/%s" % (args.subgraph_port, name) for name in SUBGRAPHS})
        ws = Workspace(root / "workspace", create=True, name="Original Hive application migration reference")
        editions = {}
        for selected in prepared["editions"]:
            edition = import_edition(ws, selected["directory"])
            editions[selected["name"]] = edition
            ensure_configuration_review(ws, edition, selected["name"])
        needs_native = not all(ledger["phases"].get(p, {}).get("complete")
                               and ledger["phases"].get(p, {}).get("owners_closed") for p in PHASES)
        if needs_native or not ledger.get("fixture_closed_at"):
            fixture = Fixture(root, ready["binary"]["path"], upstream, args.subgraph_port,
                              hashlib.sha256(encoded(binding)).hexdigest())
            if needs_native:
                fixture_observed = fixture.start()
                ledger["fixture"] = fixture_observed
            else:
                fixture_observed = ledger["fixture"]
                fixture.recover_for_close(fixture_observed.get("owner"))
        else:
            fixture_observed = ledger["fixture"]
        ledger["state"] = "running"; save()
        runtime_source = {"schema": "hive-desk-reference-runtime/v1", "build_receipt": ready,
                          "input": binding, "fixture_readiness": fixture_observed["health"]}
        retained_runtime = ws.get("reference-runtime", "original-fixture")
        if not retained_runtime:
            ws.save("reference-runtime", "original-fixture", runtime_source)
        else:
            need(retained_runtime["data"] == runtime_source, "Original runtime binding differs")
        parsed_phases = {}
        for phase in PHASES:
            edition = editions["changed" if phase == "changed" else "initial"]
            selected = native.prepare(ws, edition["id"], router,
                name="Original Hive " + ("changed" if phase == "changed" else "initial"))
            dep_id = selected["id"]
            if dep_id not in opened_deployments:
                opened_deployments.append(dep_id)
            phase_data = ledger["phases"].setdefault(phase, {"deployment_id": dep_id, "attempts": []})
            need(phase_data["deployment_id"] == dep_id, "Retained phase selects a different native deployment")
            saved_run = phase_data.get("programme_id")
            active = deployment.active(ws)
            committed = bool(saved_run and active and any(
                row.get("programme") == saved_run and row.get("deployment") == dep_id
                for row in active["data"].get("history", [])))
            if not phase_data.get("complete") and not committed:
                resume_run = None
                if saved_run:
                    old = ws.get("programme", saved_run)
                    if old and old["data"]["state"] != "complete":
                        observed = native.status(ws, dep_id)
                        current_attempt = observed["data"].get("currentAttempt") or {}
                        need(old["data"]["state"] in ("prepared", "running")
                             and all(row.get("state") == "received" for row in old["data"]["rows"])
                             and observed["observation"].get("nativeAlive")
                             and current_attempt.get("id") == old["data"]["nativeAttempt"],
                             "Reconcile the retained uncertain/ended native programme before continuation: " + saved_run)
                        resume_run = saved_run
                if resume_run is None:
                    native.start(ws, dep_id, source)
                native.wait_ready(ws, dep_id, timeout=60)
                # The original facade returns an entity; selected native status
                # is read again to retain its actual current process attempt.
                actual = native.status(ws, dep_id)
                attempt = actual["data"]["currentAttempt"]["id"]
                run_id = resume_run or "reference-" + phase + "-" + attempt
                if resume_run:
                    need(attempt == old["data"]["nativeAttempt"],
                         "The original receiving continuation selected a different native attempt")
                if run_id not in phase_data["attempts"]:
                    phase_data["attempts"].append(run_id)
                phase_data.update({"programme_id": run_id, "native_attempt": attempt})
                save()
                run = programme.run(ws, dep_id, run_id=run_id, name="Original reference: " + phase)
                checked, parsed = validate_programme(ws, run, phase)
                ensure_programme_review(ws, run, checked)
                if phase != "initial":
                    baseline = ledger["phases"]["initial"]["programme_id"]
                    comparison = programme.compare(ws, baseline, run_id)
                    phase_data["comparison_id"] = comparison["id"]
                current = deployment.active(ws)
                if not (current and current["data"]["programme"] == run_id and current["data"]["deployment"] == dep_id):
                    expected = current["revision"] if current else None
                    note = "Reference " + phase + ": complete actual twenty-operation review."
                    if phase == "rollback":
                        current = deployment.rollback(ws, dep_id, run_id, note, expected=expected)
                    else:
                        current = deployment.activate(ws, dep_id, run_id, note, expected=expected)
                phase_data.update({"validation": checked, "active_revision": current["revision"], "complete": True})
                save()
            run = ws.get("programme", phase_data["programme_id"])
            checked, parsed = validate_programme(ws, run, phase)
            phase_data["validation"] = checked
            phase_data["complete"] = True
            parsed_phases[phase] = parsed
            for row in checked["responses"]:
                raw = programme.response_body(ws, run["id"], row["id"])
                publish(root / "responses" / phase / (row["id"] + ".response"), raw)
            publish(root / "responses" / phase / "programme.json", encoded(run))
            if not phase_data.get("owners_closed"):
                stopped = stop_router(ws, dep_id)
                phase_data["owners_closed"] = not stopped["observation"]["nativeAlive"] and not stopped["observation"]["supervisorAlive"]
                save()
            emit({"stage": "original_hive_phase_complete", "phase": phase, "programme_id": run["id"],
                  "native_attempt": checked["native_attempt"], "responses": 20,
                  "owners_closed": phase_data["owners_closed"]})
            if phase == "initial" and not ledger["exports"].get("initial", {}).get("result"):
                export_once(ws, root / "initial-handoff.zip", source, ledger, "initial", save)
        for op_id, original in parsed_phases["initial"].items():
            restored = parsed_phases["rollback"][op_id]
            need(original.get("data") == restored.get("data") and original.get("errors") == restored.get("errors"),
                 "Rollback changed the original native data/errors: " + op_id)
        if fixture is not None:
            fixture.close(); fixture = None
            ledger["fixture_closed_at"] = time.time()
        ledger.setdefault("routers_closed_at", time.time()); save()
        initial_archive = ledger["exports"]["initial"]["result"]
        final_archive = export_once(ws, root / "complete-handoff.zip", source, ledger, "complete", save)
        initial_receive = receive_once(Path(initial_archive["path"]), root / "receiving-initial")
        final_receive = receive_once(Path(final_archive["path"]), root / "receiving-final")
        with Workspace(root / "receiving-initial" / "workspace") as initial:
            forward = compare_receiving(Path(final_archive["path"]), initial)
            need(forward["relation"] == "incoming-forward", "Complete descendant was not classified as forward")
        with Workspace(root / "receiving-final" / "workspace") as final:
            older = compare_receiving(Path(initial_archive["path"]), final)
            same = compare_receiving(Path(final_archive["path"]), final)
            need(older["relation"] == "current-forward" and same["relation"] == "identical",
                 "Older/same receiving did not preserve the current original history")
            for phase in PHASES:
                run = final.get("programme", ledger["phases"][phase]["programme_id"])
                validate_programme(final, run, phase)
        # Reopen the same receiving directory with the same complete archive.
        need(receive_once(Path(final_archive["path"]), root / "receiving-final") == final_receive,
             "Repeated original receiving changed its saved workspace")
        verified = ws.verify()
        retained_runs = [ws.get("programme", name) for name in {name for phase in ledger["phases"].values() for name in phase["attempts"]}]
        retained_response_count = sum(sum(row.get("state") == "received" for row in run["data"]["rows"]) for run in retained_runs if run)
        ws.close(); ws = None
        artifacts = []
        for path in [Path(initial_archive["path"]), Path(final_archive["path"]),
                     *sorted((root / "responses").rglob("*"))]:
            if path.is_file():
                artifacts.append({"path": str(path), **file_identity(path)})
        result = {"schema": "hive-desk-reference-result/v1", "operation_id": OPERATION, "complete": True,
            "source_commit": UPSTREAM_COMMIT, "input": binding, "workspace": verified,
            "phases": ledger["phases"], "selected_responses": 60,
            "retained_programme_count": len(retained_runs), "retained_response_count": retained_response_count,
            "initial_archive": initial_archive, "final_archive": final_archive,
            "receiving": {"initial": initial_receive, "complete": final_receive,
                          "forward": forward, "older": older, "same": same},
            "fixture_closed_at": ledger["fixture_closed_at"], "routers_closed_at": ledger["routers_closed_at"],
            "workspace_closed_at": time.time(), "completed_at": time.time(), "artifacts": artifacts}
        ledger["final_candidate"] = result; save()
        publish(root / "result.json", encoded(result))
        ledger["state"] = "complete"; save()
        return result
    except BaseException as error:
        if ledger is not None:
            ledger["state"] = "failed"
            ledger["errors"].append({"type": type(error).__name__, "message": str(error), "at": time.time()})
            try:
                write_json(root / "reference-receiving.json", ledger)
            except OSError:
                pass
        raise
    finally:
        cleanup_errors = []
        if ws is not None:
            for dep_id in opened_deployments:
                try:
                    stop_router(ws, dep_id)
                except Exception as error:
                    cleanup_errors.append(str(error))
            try:
                ws.close()
            except Exception as error:
                cleanup_errors.append(str(error))
        if fixture is not None:
            try:
                fixture.close()
            except Exception as error:
                cleanup_errors.append(str(error))
        os.close(lock)
        if cleanup_errors:
            emit({"stage": "original_hive_owner_close_incomplete", "errors": cleanup_errors})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--fixture-ready", type=Path, required=True)
    parser.add_argument("--router", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--initial-port", type=int, required=True)
    parser.add_argument("--changed-port", type=int, required=True)
    parser.add_argument("--subgraph-port", type=int, required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    result = execute(args)
    emit({"operation_id": result["operation_id"], "complete": result["complete"],
          "result": str(args.root.absolute() / "result.json"),
          "selected_responses": result["selected_responses"], "final_archive": result["final_archive"]})


if __name__ == "__main__":
    main()

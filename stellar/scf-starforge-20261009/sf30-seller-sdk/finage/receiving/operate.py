#!/usr/bin/env python3
"""Receive two complete Finage deliveries through the original customer warehouse.

This is an operated delivery continuation. The selected receiver owns all data,
selection, query, export and recovery behavior. This program retains original
command outputs and resumes the same operation after process interruption.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "finage.customer-receiving-operation/v1"


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def require(value, message):
    if not value:
        raise RuntimeError(message)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()


def file_identity(path):
    p = Path(path)
    with p.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"bytes": p.stat().st_size, "sha256": digest}


def atomic_json(path, value):
    path = Path(path)
    temp = path.with_name(path.name + ".pending-" + str(os.getpid()))
    try:
        with temp.open("xb") as stream:
            os.chmod(temp, 0o600)
            stream.write(json_bytes(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temp.exists():
            temp.unlink()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


class Operation:
    def __init__(self, config, resume=False, source_change=None):
        self.config = config
        require(config.get("schema") == SCHEMA, "Use the Finage receiving operation config.")
        for key in ("operation_id", "output", "actor", "source_pin"):
            require(isinstance(config.get(key), str) and config[key].strip(), "Missing " + key)
        self.root = Path(config["output"]).absolute()
        self.root.parent.mkdir(parents=True, exist_ok=True)
        self.root.mkdir(mode=0o700, exist_ok=True)
        self.lock = (self.root / ".operation.lock").open("a+b")
        try:
            fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("This same receiving operation already has an owner.")
        self.command = config.get("receiver_command")
        require(isinstance(self.command, list) and self.command and
                all(isinstance(x, str) and x for x in self.command),
                "Provide the original Finage receiver command as an argument array.")
        require(len(config.get("deliveries", [])) == 2, "Select exactly two complete original exports.")
        self.inputs = []
        for index, selected in enumerate(config["deliveries"]):
            directory = Path(selected["directory"]).resolve(strict=True)
            manifest_path = directory / "manifest.json"
            raw = manifest_path.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            require(digest == selected["manifest_sha256"], "An original export manifest changed.")
            manifest = json.loads(raw)
            count = manifest.get("customerRecords")
            require(type(count) is int and count > 0, "The actual complete export must contain customer rows.")
            require(manifest.get("allSelectedRecordsProcessed") is True,
                    "Select the original complete processor output.")
            self.inputs.append({
                "directory": str(directory), "manifest_sha256": digest,
                "delivery_id": "delivery-" + digest, "edition_id": manifest["editionId"],
                "label": selected.get("label") or manifest["editionId"],
                "customer_records": count, "assessment_ready": manifest.get("assessmentReady"),
                "manifest": manifest,
            })
        require(self.inputs[0]["delivery_id"] != self.inputs[1]["delivery_id"],
                "The two selections identify the same original manifest.")
        source_files = config.get("receiver_source_files", [])
        require(source_files and all(isinstance(x, str) for x in source_files),
                "Retain the actual receiver and provider-profile source paths.")
        self.sources = [{"path": str(Path(x).resolve(strict=True)), **file_identity(x)} for x in source_files]
        self.intent = {
            "schema": SCHEMA, "operation_id": config["operation_id"], "actor": config["actor"],
            "receiver_command": self.command,
            "inputs": [{k: x[k] for k in ("directory", "manifest_sha256", "delivery_id",
                                         "edition_id", "label", "customer_records", "assessment_ready")}
                       for x in self.inputs],
            "filter": config.get("filter"),
        }
        self.checkpoint_path = self.root / "receiving-checkpoint.json"
        if self.checkpoint_path.exists():
            require(resume, "Use --resume to continue this retained operation.")
            self.c = load(self.checkpoint_path)
            require(self.c["intent"] == self.intent, "The retained operation belongs to different original inputs or decisions.")
            if self.c["receiver_sources"] != self.sources:
                require(source_change and source_change.strip(),
                        "A source revision needs --accept-source-change with its concrete correction.")
                self.c.setdefault("source_revisions", []).append({
                    "at": now(), "reason": source_change, "previous": self.c["receiver_sources"],
                    "selected": self.sources, "source_pin": config["source_pin"],
                })
                self.c["receiver_sources"] = self.sources
        else:
            require(not any(x.name not in (".operation.lock",) for x in self.root.iterdir()),
                    "Choose a new operation directory; existing unrelated content is preserved.")
            self.c = {
                "schema": SCHEMA, "intent": self.intent, "started_at": now(),
                "source_pin": config["source_pin"], "receiver_sources": self.sources,
                "stages": {}, "commands": [], "decisions": {}, "outputs": {},
                "attempts": [], "source_revisions": [],
            }
        for name in ("commands", "exports", "backups", "views"):
            (self.root / name).mkdir(exist_ok=True)
        self.warehouse = self.root / "warehouse"
        self.c["attempts"].append({"started_at": now(), "pid": os.getpid()})
        self.save()

    def save(self):
        self.c["updated_at"] = now()
        atomic_json(self.checkpoint_path, self.c)

    def close(self):
        self.lock.close()

    def stage(self, name, work):
        prior = self.c["stages"].get(name)
        if prior and prior.get("status") == "COMPLETE":
            return prior["result"]
        self.c["active_stage"] = name
        self.save()
        print(json.dumps({"stage": name, "status": "running"}), flush=True)
        try:
            result = work()
        except BaseException as error:
            self.c["stages"][name] = {"status": "INTERRUPTED", "at": now(),
                                      "error": type(error).__name__, "message": str(error)}
            self.save()
            raise
        self.c["stages"][name] = {"status": "COMPLETE", "completed_at": now(), "result": result}
        self.save()
        print(json.dumps({"stage": name, "status": "complete"}), flush=True)
        return result

    def launch(self, name, args):
        number = len(self.c["commands"]) + 1
        base = self.root / "commands" / ("%04d-" % number + name)
        stdout = base.with_suffix(".stdout.json")
        stderr = base.with_suffix(".stderr.txt")
        event = {"name": name, "argv": [*self.command, *args], "started_at": now(),
                 "stdout_path": str(stdout), "stderr_path": str(stderr)}
        self.c["commands"].append(event)
        self.save()
        out, err = stdout.open("xb"), stderr.open("xb")
        try:
            process = subprocess.Popen(event["argv"], stdout=out, stderr=err)
        finally:
            out.close()
            err.close()
        event["pid"] = process.pid
        self.save()
        return process, event

    def finish(self, process, event, allowed_error=None):
        code = process.wait()
        event.update(ended_at=now(), return_code=code,
                     stdout=file_identity(event["stdout_path"]), stderr=file_identity(event["stderr_path"]))
        self.save()
        out = Path(event["stdout_path"]).read_text(encoding="utf-8").strip()
        err = Path(event["stderr_path"]).read_text(encoding="utf-8").strip()
        if code != 0:
            try:
                native_error = json.loads(err)["error"]
            except (ValueError, KeyError, TypeError):
                native_error = {"code": "PROCESS_EXIT", "message": err[-3000:]}
            if allowed_error and native_error.get("code") == allowed_error:
                return {"native_error": native_error, "return_code": code}
            raise RuntimeError("Original receiver " + event["name"] + " failed: " + str(native_error))
        require(not allowed_error, "The original receiver unexpectedly accepted " + event["name"])
        try:
            return json.loads(out)
        except ValueError as exc:
            raise RuntimeError("The original command did not return its JSON result: " + event["name"]) from exc

    def call(self, name, args, allowed_error=None):
        process, event = self.launch(name, args)
        try:
            return self.finish(process, event, allowed_error)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()

    def args(self, action, warehouse=None):
        return [action, "--warehouse", str(warehouse or self.warehouse)]

    def status(self, warehouse=None):
        return self.call("status", self.args("status", warehouse))

    def receive(self, selected):
        return self.call("receive", [*self.args("receive"), "--delivery-directory", selected["directory"]])

    def saved_delivery(self, selected):
        return next((x for x in self.status()["deliveries"] if x["id"] == selected["delivery_id"]), None)

    def prefix(self, selected):
        """Inspect the original warehouse's committed rows; never alter its tables."""
        uri = (self.warehouse / "warehouse.sqlite3").resolve().as_uri() + "?mode=ro"
        with contextlib.closing(sqlite3.connect(uri, uri=True, timeout=0.05, isolation_level=None)) as db:
            cursor = db.execute("SELECT state,imported_rows FROM deliveries WHERE id=?", (selected["delivery_id"],))
            row = cursor.fetchone()
            cursor.close()
            return None if row is None else {"state": row[0], "rows": row[1]}

    def interrupt_one_receive(self, selected):
        existing = self.saved_delivery(selected)
        if existing and existing["state"] == "importing" and 0 < existing["imported_rows"] < selected["customer_records"]:
            return {"observed": True, "basis": "retained original interrupted import",
                    "delivery_id": selected["delivery_id"], "committed_rows": existing["imported_rows"]}
        if existing and existing["state"] == "staged":
            return {"observed": False, "basis": "original delivery already staged", "delivery_id": selected["delivery_id"]}
        process, event = self.launch("receive-interrupted", [*self.args("receive"),
                                              "--delivery-directory", selected["directory"]])
        observed = None
        deadline = time.monotonic() + 180
        try:
            while process.poll() is None:
                if time.monotonic() > deadline:
                    raise TimeoutError("The original receiving child exceeded the operation observation window.")
                try:
                    value = self.prefix(selected)
                except sqlite3.OperationalError:
                    value = None
                if value and value["state"] == "importing" and 0 < value["rows"] < selected["customer_records"]:
                    observed = {**value, "at": now()}
                    # Own child only: stop its next row, then deliver a normal Python
                    # interrupt so the original transaction handler rolls back and closes.
                    process.send_signal(signal.SIGSTOP)
                    process.send_signal(signal.SIGINT)
                    process.send_signal(signal.SIGCONT)
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    break
                time.sleep(0.002)
            code = process.wait()
            event.update(ended_at=now(), return_code=code,
                         stdout=file_identity(event["stdout_path"]), stderr=file_identity(event["stderr_path"]))
            self.save()
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        # The original receiver's BaseException branch has closed the failed batch.
        retained = self.saved_delivery(selected)
        if retained and retained["state"] == "importing" and 0 < retained["imported_rows"] < selected["customer_records"]:
            return {"observed": True, "basis": "owned original child interrupted after a committed batch",
                    "delivery_id": selected["delivery_id"], "committed_rows": retained["imported_rows"],
                    "observation": observed, "actual_child_return_code": code,
                    "command_stdout": event["stdout_path"], "command_stderr": event["stderr_path"]}
        require(code == 0 and retained and retained["state"] == "staged",
                "The native intake stopped without a readable committed prefix; preserve its original error.")
        return {"observed": False, "basis": "original receiving completed before the interruption observation",
                "delivery_id": selected["delivery_id"], "actual_child_return_code": code}

    def decision(self, label, selected, rollback=False, expected=None):
        saved = self.c["decisions"].get(label)
        if saved is None:
            head = expected or self.status()["head"]
            saved = {"operation_id": self.config["operation_id"] + ":" + label,
                     "delivery_id": selected["delivery_id"], "expected": head,
                     "actor": self.config["actor"],
                     "reason": ("Return to" if rollback else "Select") + " the retained original " +
                               selected["label"] + " for this local receiving operation; original source scope and assessment are unchanged.",
                     "rollback": rollback}
            self.c["decisions"][label] = saved
            self.save()
        head = saved["expected"]
        return self.call(label, [*self.args("rollback" if saved["rollback"] else "activate"),
            "--delivery", saved["delivery_id"], "--expected-generation", str(head["generation"]),
            "--expected-delivery", head["delivery_id"] or "none", "--actor", saved["actor"],
            "--reason", saved["reason"], "--operation-id", saved["operation_id"]])

    def query(self, selected, after=0, filters=None, warehouse=None):
        return self.call("query", [*self.args("query", warehouse), "--delivery", selected["delivery_id"],
            "--after", str(after), "--limit", "1000", "--filters-json", json.dumps(filters or [], ensure_ascii=False)])

    def compare_original_rows(self, selected, warehouse=None):
        count, after, first = 0, 0, None
        digest = hashlib.sha256()
        with (Path(selected["directory"]) / "customer" / "mapped-records.ndjson").open("rb") as original:
            while True:
                page = self.query(selected, after=after, warehouse=warehouse)
                require(page["deliveryId"] == selected["delivery_id"] and
                        page["originalManifestSha256"] == selected["manifest_sha256"], "Query source identity changed.")
                require(page["total"] == selected["customer_records"], "The native query does not expose the complete original selection.")
                if first is None and page["items"]:
                    first = page["items"][0]
                for row in page["items"]:
                    line = original.readline()
                    require(line and row["ordinal"] == count + 1 and
                            row["exactJson"] == line.decode("utf-8").rstrip("\r\n"),
                            "A received row differs from its exact original JSON record.")
                    require(all(c["text"] is None or isinstance(c["text"], str) for c in row["cells"]),
                            "Received values must retain exact text and original JSON kinds.")
                    count += 1
                    digest.update(line)
                if page["nextAfter"] is None:
                    break
                require(page["nextAfter"] > after, "The original query cursor did not advance.")
                after = page["nextAfter"]
            require(not original.read(1), "Original rows remain after the last received page.")
        require(count == selected["customer_records"], "The original row stream is incomplete.")
        return {"delivery_id": selected["delivery_id"], "rows": count, "original_ndjson_sha256": digest.hexdigest(),
                "first_row": first}

    def destination(self, label, parent, completion):
        saved = self.c["outputs"].get(label)
        if saved and (Path(saved) / completion).is_file():
            return Path(saved), True
        if saved and Path(saved).exists():
            self.c.setdefault("incomplete_outputs", []).append({"label": label, "directory": saved, "observed_at": now()})
        suffix = sum(1 for x in self.c.get("incomplete_outputs", []) if x["label"] == label)
        target = self.root / parent / (label + ("-continuation-" + str(suffix) if suffix else ""))
        require(not target.exists(), "An unexpected destination already exists: " + str(target))
        self.c["outputs"][label] = str(target)
        self.save()
        return target, False

    def verify_inventory(self, root, manifest):
        for entry in manifest["files"]:
            path = Path(root) / entry["path"]
            require(path.resolve().is_relative_to(Path(root).resolve()), "An export member escaped its directory.")
            require(file_identity(path) == {"bytes": entry["bytes"], "sha256": entry["sha256"]},
                    "An original export member changed: " + entry["path"])

    def export(self, label, selected, filters=None, warehouse=None):
        target, complete = self.destination(label, "exports", "receiving-manifest.json")
        if not complete:
            self.call("export", [*self.args("export", warehouse), "--delivery", selected["delivery_id"],
                                "--filters-json", json.dumps(filters or [], ensure_ascii=False), "--out", str(target)])
        receipt = load(target / "receiving-manifest.json")
        require(receipt["deliveryId"] == selected["delivery_id"] and
                receipt["originalManifestSha256"] == selected["manifest_sha256"] and
                receipt["filters"] == (filters or []), "The retained export belongs to a different selection.")
        self.verify_inventory(target, receipt)
        if not filters:
            expected = {x["path"]: x for x in selected["manifest"]["files"]}
            for relative in ("customer/mapped-records.ndjson", "customer/mapped-records.csv"):
                require(file_identity(target / relative) == {k: expected[relative][k] for k in ("bytes", "sha256")},
                        "The complete export changed original customer bytes.")
        return {"directory": str(target), "manifest": file_identity(target / "receiving-manifest.json"),
                "selection": receipt["selection"], "selected_records": receipt["selectedRecords"],
                "delivery_id": selected["delivery_id"], "filters": receipt["filters"]}

    def execute(self):
        one, two = self.inputs

        def initialize():
            if not self.warehouse.exists():
                self.call("init", self.args("init"))
            value = self.status()
            require(value["head"] == {"generation": 0, "delivery_id": None},
                    "This receiving operation must begin with its own new customer warehouse.")
            return {"warehouse": str(self.warehouse), "initial_head": value["head"]}
        self.stage("01_original_inputs_and_warehouse", initialize)

        def interrupted_intake():
            observations = []
            for selected in self.inputs:
                prior = self.c.get("prefix_observation")
                if prior and prior.get("observed"):
                    break
                observation = self.interrupt_one_receive(selected)
                observations.append(observation)
                self.c["prefix_observation"] = observation
                self.save()
                if observation["observed"]:
                    break
            require(self.c.get("prefix_observation", {}).get("observed"),
                    "Both original exports completed before an interrupted prefix was observed. Their completed data remains retained; do not claim or manufacture an interruption.")
            return {"interruption": self.c["prefix_observation"], "actual_observations": observations}
        interrupted = self.stage("02_original_interrupted_prefix", interrupted_intake)

        def complete_intake():
            results = []
            for selected in self.inputs:
                received = self.receive(selected)
                require(received["id"] == selected["delivery_id"] and received["state"] == "staged" and
                        received["importedRows"] == selected["customer_records"] and
                        received["originalManifestSha256"] == selected["manifest_sha256"] and
                        received["originalManifest"]["assessmentReady"] is selected["assessment_ready"],
                        "The original receiving result does not preserve its source and assessment.")
                prefix = interrupted["interruption"]
                if selected["delivery_id"] == prefix["delivery_id"] and "resumedRows" in received:
                    require(received["resumedRows"] >= prefix["committed_rows"],
                            "The same native import did not reuse its committed original prefix.")
                results.append({"id": received["id"], "rows": received["importedRows"],
                                "resumed_rows": received.get("resumedRows"), "reused": received.get("reused"),
                                "original_assessment_ready": received["originalManifest"]["assessmentReady"]})
            repeat = self.receive(one)
            require(repeat.get("reused") is True, "Repeating the complete original intake must reuse its delivery.")
            return {"received": results, "complete_repeat_reused": True}
        self.stage("03_complete_original_receiving", complete_intake)

        def selections():
            initial = self.c["stages"]["01_original_inputs_and_warehouse"]["result"]["initial_head"]
            first = self.decision("select-first", one, expected=initial)
            replay = self.decision("select-first", one, expected=initial)
            require(replay["reused"] is True and first["generation"] == replay["generation"],
                    "Exact customer decision replay changed the selection.")
            stale = self.call("stale-head", [*self.args("activate"), "--delivery", two["delivery_id"],
                "--expected-generation", str(initial["generation"]), "--expected-delivery", initial["delivery_id"] or "none",
                "--actor", self.config["actor"], "--reason", "Original earlier displayed head, retained to inspect the actual conflict.",
                "--operation-id", self.config["operation_id"] + ":stale-selection"], allowed_error="HEAD_CONFLICT")
            second = self.decision("select-second", two, expected={"generation": first["generation"], "delivery_id": one["delivery_id"]})
            require(second["originalManifestSha256"] == two["manifest_sha256"] and
                    second["originalAssessmentReady"] is two["assessment_ready"], "Selection relabeled the original assessment.")
            return {"first": first, "exact_replay": replay, "stale_head": stale, "second": second}
        self.stage("04_named_selection_replay_and_conflict", selections)

        def queries():
            received = [self.compare_original_rows(x) for x in self.inputs]
            candidate = self.config.get("filter")
            if candidate is None:
                cells = received[1]["first_row"]["cells"]
                preferred = ("symbol", "ticker", "instrument_id", "instrument", "pair")
                valid = [x for x in cells if x["kind"] in ("string", "number") and x["text"] not in (None, "")]
                require(valid, "Select an explicit exact-text query from an original non-null cell.")
                chosen = next((x for name in preferred for x in valid if x["name"].lower() == name), valid[0])
                candidate = {"column": chosen["name"], "op": "eq", "value": chosen["text"], "kind": chosen["kind"]}
            self.c["selected_filter"] = candidate
            self.save()
            before = self.query(two, filters=[candidate])
            self.call("index", [*self.args("index"), "--delivery", two["delivery_id"], "--column", candidate["column"]])
            after = self.query(two, filters=[candidate])
            require(before["items"] == after["items"] and before["total"] == after["total"],
                    "The optional native exact-text index changed its query result.")
            count, cursor, original_ordinal, digest = 0, 0, 0, hashlib.sha256()
            original_path = Path(two["directory"]) / "customer" / "mapped-records.ndjson"
            with original_path.open("rb") as original:
                while True:
                    page = after if cursor == 0 else self.query(two, after=cursor, filters=[candidate])
                    for row in page["items"]:
                        require(row["ordinal"] > original_ordinal, "Filtered source ordinals did not advance.")
                        while original_ordinal < row["ordinal"]:
                            line = original.readline()
                            require(line, "A filtered ordinal is outside the original source.")
                            original_ordinal += 1
                        require(row["exactJson"] == line.decode("utf-8").rstrip("\r\n"),
                                "The filtered native row differs from its original bytes.")
                        count += 1
                        digest.update(line)
                    if page["nextAfter"] is None:
                        break
                    cursor = page["nextAfter"]
            require(count == after["total"], "Filtered native pagination is incomplete.")
            return {"original_deliveries": [{k:v for k,v in x.items() if k != "first_row"} for x in received],
                    "filter": candidate, "filtered_rows": count, "filtered_original_ndjson_sha256": digest.hexdigest(),
                    "index_preserves_selection": True}
        query_result = self.stage("05_exact_rows_native_index_and_filter", queries)

        def exports():
            first = self.export("first-complete", one)
            second = self.export("second-complete", two)
            filtered = self.export("second-filtered", two, [self.c["selected_filter"]])
            require(filtered["selected_records"] == query_result["filtered_rows"],
                    "Filtered delivery does not match the exact native query.")
            # Preserve the original selected line endings and numeric lexemes.
            filtered_json = Path(filtered["directory"]) / "customer" / "mapped-records.ndjson"
            require(file_identity(filtered_json)["sha256"] == query_result["filtered_original_ndjson_sha256"],
                    "Filtered export differs from the complete exact-text selection.")
            return {"first": first, "second": second, "filtered": filtered}
        exported = self.stage("06_complete_and_filtered_customer_handover", exports)

        def rollback():
            second = self.c["stages"]["04_named_selection_replay_and_conflict"]["result"]["second"]
            decision = self.decision("rollback-first", one, rollback=True,
                                     expected={"generation": second["generation"], "delivery_id": two["delivery_id"]})
            status = self.status()
            require(status["head"] == {"generation": decision["generation"], "delivery_id": one["delivery_id"]},
                    "Fresh original status did not retain the rollback.")
            require(len(status["deliveries"]) == 2 and len(status["decisions"]) == 3,
                    "Customer decisions duplicated or removed a retained delivery.")
            return {"decision": decision, "fresh_status": status}
        rolled_back = self.stage("07_explicit_rollback_and_fresh_reopen", rollback)

        def recovery():
            backup, complete = self.destination("complete-warehouse", "backups", "backup-manifest.json")
            if not complete:
                self.call("backup", [*self.args("backup"), "--out", str(backup)])
            manifest = load(backup / "backup-manifest.json")
            self.verify_inventory(backup, manifest)
            require(manifest["head"] == rolled_back["fresh_status"]["head"], "Backup retained a different customer head.")
            restored = Path(self.c["outputs"].get("restored-warehouse", str(self.root / "restored-warehouse")))
            expected_database = next(x for x in manifest["files"] if x["path"] == "warehouse.sqlite3")
            if restored.exists():
                database = restored / "warehouse.sqlite3"
                complete_copy = database.is_file() and file_identity(database) == {
                    k: expected_database[k] for k in ("bytes", "sha256")}
                if not complete_copy:
                    self.c.setdefault("incomplete_outputs", []).append({
                        "label": "restored-warehouse", "directory": str(restored), "observed_at": now(),
                        "reason": "Prior receiving process ended before the exact original backup copy completed."})
                    ordinal = sum(1 for x in self.c["incomplete_outputs"] if x["label"] == "restored-warehouse")
                    restored = self.root / ("restored-warehouse-continuation-" + str(ordinal))
                    require(not restored.exists(), "Preserve an existing restore destination.")
            self.c["outputs"]["restored-warehouse"] = str(restored)
            self.save()
            bundled_receiver = backup / "receiver.py"
            bundled_identity = file_identity(bundled_receiver)
            require(any(x["sha256"] == bundled_identity["sha256"] for x in self.sources),
                    "The portable engine does not match a selected original receiver source.")
            original_command = self.command
            bundled_command = [original_command[0], str(bundled_receiver), "--profile", "finage"]
            try:
                self.command = bundled_command
                if not restored.exists():
                    self.call("restore", ["restore", "--bundle", str(backup), "--out", str(restored)])
                status = self.status(restored)
                require(status == rolled_back["fresh_status"], "The fresh restored warehouse differs from its retained original state.")
                for selected in self.inputs:
                    self.compare_original_rows(selected, warehouse=restored)
                native_export = self.export("restored-active-complete", one, warehouse=restored)
            finally:
                self.command = original_command
            return {"backup_directory": str(backup), "backup_manifest": file_identity(backup / "backup-manifest.json"),
                    "bundled_receiver": bundled_identity, "actual_restored_command": bundled_command,
                    "restored_warehouse": str(restored), "head": status["head"], "deliveries": len(status["deliveries"]),
                    "decisions": len(status["decisions"]), "restored_original_export": native_export}
        self.stage("08_native_backup_restore_and_exact_reopen", recovery)

        def reading_views():
            browser = self.config.get("browser")
            require(isinstance(browser, dict), "Provide the selected existing browser runtime for the complete reading view.")
            browser_config = {
                **browser, "output": str(self.root / "views"),
                "html": str(Path(exported["second"]["directory"]) / "receiving-overview.html"),
                "filtered_html": str(Path(exported["filtered"]["directory"]) / "receiving-overview.html"),
                "expected_brand": "Finage",
                "original_customer_records": two["customer_records"],
                "filtered_records": exported["filtered"]["selected_records"],
                "delivery_id": two["delivery_id"], "original_edition_id": two["edition_id"],
                "original_assessment_ready": two["assessment_ready"],
            }
            path = self.root / "reading-view-config.json"
            atomic_json(path, browser_config)
            driver = Path(__file__).with_name("read-views.mjs")
            require(driver.is_file(), "Keep the complete original receiving program together with read-views.mjs.")
            child = subprocess.run([browser["node"], str(driver), str(path)], check=False,
                                   stdout=(self.root / "views" / "reader.stdout.txt").open("wb"),
                                   stderr=(self.root / "views" / "reader.stderr.txt").open("wb"))
            require(child.returncode == 0, "The existing customer reading view did not complete; inspect its retained reader output.")
            result = load(self.root / "views" / "READING_VIEW_RESULT.json")
            require(result.get("status") == "COMPLETE", "The existing reading view has no completed original result.")
            return result
        self.stage("09_existing_desktop_mobile_reading_view", reading_views)
        self.c["status"] = "COMPLETE"
        self.c["completed_at"] = now()
        self.c["active_stage"] = None
        self.save()
        result = {
            "schema": SCHEMA, "status": "COMPLETE", "operation_id": self.config["operation_id"],
            "started_at": self.c["started_at"], "completed_at": self.c["completed_at"],
            "source_pin": self.config["source_pin"], "receiver_sources": self.c["receiver_sources"],
            "original_inputs": self.intent["inputs"], "actor": self.config["actor"],
            "stages": self.c["stages"], "warehouse": str(self.warehouse),
            "checkpoint": str(self.checkpoint_path), "original_command_count": len(self.c["commands"]),
            "customer_record_count": sum(x["customer_records"] for x in self.inputs),
            "provider_calls": 0, "payments": 0,
        }
        atomic_json(self.root / "RECEIVING_RESULT.json", result)
        print(json.dumps({"status": "COMPLETE", "result": str(self.root / "RECEIVING_RESULT.json"),
                          **file_identity(self.root / "RECEIVING_RESULT.json")}), flush=True)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--accept-source-change", metavar="REASON")
    args = parser.parse_args()
    operation = Operation(load(args.config), args.resume, args.accept_source_change)
    try:
        operation.execute()
    finally:
        operation.close()


if __name__ == "__main__":
    main()

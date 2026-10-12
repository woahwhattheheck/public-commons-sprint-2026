"""Complete migration work: inventory, native projects, output review and support."""
from __future__ import annotations

import base64
import copy
import csv
import io
import json
from pathlib import Path
import secrets
import tempfile
import threading
import zipfile
from . import archive, native
from .compare import compare_outputs, read_csv, csv_bytes
from .providers import Rollouts, capture_results
from .report_server import ReportServer
from .sql_server import SqlServer, SQL_KINDS
from .store import Store, Conflict, digest, encoded, identifier, now

KINDS = ("source", "dataset", "plan", "artifact", "capture", "comparison", "rollout", "support", "usage", "delivery", "backup", "server_report", "server_bundle", "server_job", "server_result")


def decoded_file(request):
    try:
        data = base64.b64decode(request["base64"], validate=True)
    except Exception:
        raise ValueError("Select a complete file for import.") from None
    filename = Path(str(request.get("filename", "input"))).name
    if not filename or any(ord(c) < 32 for c in filename):
        raise ValueError("The input filename is invalid.")
    return data, filename


def text(value, maximum=10000):
    return str(value or "").strip()[:maximum]


def package_files(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for path, data in sorted(files.items()):
            info = zipfile.ZipInfo(path, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            package.writestr(info, data)
    return output.getvalue()


class Service:
    def __init__(self, workspace):
        self.store = Store(workspace)
        self.lock = threading.RLock()
        self.operation_id = None
        self.actor = "operator"
        self.rollouts = Rollouts(self)
        self.report_server = ReportServer(self)
        self.actions = {
            "source.import": self.source_import, "source.assign": self.source_assign,
            "dataset.import": self.dataset_import, "dataset.correct": self.dataset_correct,
            "plan.create": self.plan_create, "plan.save": self.plan_save, "artifact.build": self.artifact_build,
            "comparison.run": self.comparison_run, "capture.run": self.capture_run,
            "usage.import": self.usage_import, "support.save": self.support_save,
            "rollout.create": self.rollouts.create, "rollout.advance": self.rollouts.advance,
            "rollout.reconcile": self.rollouts.reconcile, "rollout.rollback": self.rollouts.rollback,
            "delivery.build": self.delivery_build, "backup.create": self.backup_create,
            "example.load": self.example_load,
            "server.native.import": self.report_server.import_native,
            "server.native.register": self.report_server.register_native,
            "server.family.build": self.report_server.build_family,
            "server.job.prepare": self.report_server.prepare_job,
            "server.result.import": self.report_server.import_result,
            "server.handoff": self.report_server.handoff,
        }
        self.sql = SqlServer(self)
        self.actions.update(self.sql.actions())

    def close(self):
        self.sql.close()
        self.store.close()

    @staticmethod
    def reference(record):
        return {"kind": record["kind"], "id": record["id"], "revision": record["revision"]}

    def write(self, kind, payload, entity_id=None, expected=0):
        value = {**payload, "_operation_id": self.operation_id}
        return self.store.put(kind, value, entity_id or self.operation_id, expected, self.actor)

    def dispatch(self, action, request):
        if action not in self.actions:
            raise ValueError("Unknown workspace action.")
        if not isinstance(request, dict):
            raise ValueError("The action body must be an object.")
        request = copy.deepcopy(request)
        operation_id = identifier(request.pop("operation_id", None) or secrets.token_hex(16))
        with self.lock:
            previous = self.store.begin_operation(operation_id, action,
                {**request, "password": "(provided)"} if "password" in request else request)
            if previous is not None:
                return {"record": previous, "operation_id": operation_id, "replayed": True}
            prior_operation, prior_actor = self.operation_id, self.actor
            self.operation_id = operation_id
            self.actor = text(request.get("actor", "operator"), 180)
            try:
                result = self.actions[action](request)
                self.store.finish_operation(operation_id, result)
                return {"record": result, "operation_id": operation_id, "replayed": False}
            except Exception as error:
                self.store.finish_operation(operation_id, error=str(error))
                raise
            finally:
                self.operation_id, self.actor = prior_operation, prior_actor

    def state(self):
        result = {"workspace_id": self.store.setting("workspace_id"), "version": "1.0.0", "time": now()}
        for kind in (*KINDS, *SQL_KINDS):
            records = self.store.list(kind)
            for record in records:
                payload = record["payload"]
                for bulky in ("project", "source_project", "mapping", "unmatched", "details"):
                    payload.pop(bulky, None)
                if kind == "comparison":
                    payload["result"].pop("differences", None)
                if kind == "artifact":
                    payload["build"]["file_count"] = len(payload["build"].get("files", []))
                    payload.get("build", {}).pop("files", None)
            result[kind] = records
        result["sql_runtime"] = self.sql.runtime()
        result["sql_detached_jobs"] = json.loads(self.store.setting("sql_detached_jobs") or "[]")
        result["operations"] = self.store.operations()
        return result

    def source_import(self, request):
        data, filename = decoded_file(request)
        original = self.store.blob(data, filename, "application/xml" if filename.lower().endswith(".xml") else "application/json")
        with tempfile.TemporaryDirectory(prefix="source-", dir=self.store.root) as work:
            path = Path(work) / filename
            path.write_bytes(data)
            parsed = native.analyze(path, filename)
        return self.write("source", {"label": text(request.get("label", filename), 300),
            "original": original, "format": parsed["kind"], "project": parsed["project"], "inventory": parsed["inventory"],
            "owner": text(request.get("owner"), 180), "business_use": text(request.get("business_use")),
            "priority": int(request.get("priority", 3)), "wave": text(request.get("wave"), 100), "state": "imported",
            "source_system": text(request.get("source_system", "Cognos"), 180)})

    def source_assign(self, request):
        record = self.store.get("source", request["id"])
        payload = record["payload"]
        for key in ("owner", "business_use", "wave", "state"):
            if key in request:
                payload[key] = text(request[key], 10000 if key == "business_use" else 180)
        if "priority" in request:
            payload["priority"] = int(request["priority"])
            if payload["priority"] not in range(1, 6):
                raise ValueError("Use priority 1 through 5.")
        return self.write("source", payload, record["id"], request["expected"])

    def dataset_import(self, request):
        data, filename = decoded_file(request)
        headers, rows = read_csv(data)
        original = self.store.blob(data, filename, "text/csv")
        parent = self.store.get("dataset", request["parent_id"]) if request.get("parent_id") else None
        return self.write("dataset", {"label": text(request.get("label", filename), 300), "file": original,
            "columns": headers, "rows": len(rows), "null_token": request.get("null_token"),
            "scope": text(request.get("scope")), "source_url": text(request.get("source_url"), 3000),
            "description": text(request.get("description")), "parent": self.reference(parent) if parent else None,
            "correction_note": text(request.get("correction_note")), "origin": text(request.get("origin", "file"), 180)})

    def dataset_correct(self, request):
        parent = self.store.get("dataset", request["id"], request.get("revision"))
        payload = parent["payload"]
        headers, rows = read_csv(self.store.bytes(payload["file"]["digest"]))
        changes = request.get("changes", [])
        if not changes:
            raise ValueError("Enter at least one exact source-row correction.")
        applied = []
        seen = set()
        for change in changes:
            index, column = int(change["row"]), change["column"]
            if index < 1 or index > len(rows) or column not in headers or (index, column) in seen:
                raise ValueError("Each correction must identify one distinct existing data row and column.")
            seen.add((index, column))
            previous = rows[index - 1][column]
            if previous != str(change["expected"]):
                raise Conflict(f"Row {index}, {column} no longer matches the expected original cell.")
            value = str(change["value"])
            rows[index - 1][column] = value
            applied.append({"row": index, "column": column, "from": previous, "to": value})
        if not text(request.get("note")):
            raise ValueError("Describe the reason for the correction.")
        correction_file = self.store.blob(csv_bytes(headers, rows), "corrected-" + payload["file"]["name"], "text/csv")
        return self.write("dataset", {**{k: v for k, v in payload.items() if k != "_operation_id"},
            "label": text(request.get("label", payload["label"] + " — corrected"), 300), "file": correction_file,
            "parent": self.reference(parent), "corrections": applied, "correction_note": text(request["note"])})

    def plan_create(self, request):
        source = self.store.get("source", request["source_id"], request.get("source_revision"))
        project = copy.deepcopy(source["payload"]["project"])
        if request.get("project_name"):
            project["name"] = identifier(request["project_name"])
        return self.write("plan", {"label": text(request.get("label", source["payload"]["label"]), 300),
            "source": self.reference(source), "source_digest": source["payload"]["original"]["digest"],
            "project_key": source["id"], "project": project, "bindings": {}, "review_decisions": [],
            "owner": source["payload"].get("owner", ""), "scope": "", "state": "editing", "notes": ""})

    def plan_save(self, request):
        record = self.store.get("plan", request["id"])
        given = request["plan"]
        original = record["payload"]
        project = native.validate_project(given["project"]).model_dump(mode="json")
        bindings = given.get("bindings", {})
        if not isinstance(bindings, dict) or set(bindings) - {t["name"] for t in project["tables"]}:
            raise ValueError("Bindings must reference actual model tables.")
        for binding in bindings.values():
            if binding.get("kind") == "csv":
                self.store.bytes(binding["digest"])
            elif binding.get("kind") not in {"sqlserver", "m"}:
                raise ValueError("Use CSV, SQL Server or native Power Query bindings.")
        decisions = given.get("review_decisions", [])
        if not isinstance(decisions, list) or any(not isinstance(item, dict) for item in decisions):
            raise ValueError("Review decisions must be a list of objects.")
        # Parsed findings remain available even when an operator corrects the model.
        source = self.store.get("source", original["source"]["id"], original["source"]["revision"])
        return self.write("plan", {**original, "project": project, "bindings": bindings,
            "review_decisions": decisions, "source_review_items": source["payload"]["project"].get("review_flags", []),
            **{k: text(given.get(k, original.get(k, ""))) for k in ("label", "owner", "scope", "notes", "state")}},
            record["id"], request["expected"])

    def artifact_build(self, request):
        plan = self.store.get("plan", request["plan_id"], request.get("plan_revision"))
        payload = plan["payload"]
        with tempfile.TemporaryDirectory(prefix="build-", dir=self.store.root) as temp:
            folder = Path(temp)
            build = native.build(payload, self.store.bytes, folder)
            files = {str(p.relative_to(folder)): p.read_bytes() for p in folder.rglob("*") if p.is_file()}
            files["BUILD_MANIFEST.json"] = encoded({"plan": self.reference(plan), "source_digest": payload["source_digest"], **build}).encode()
            package = self.store.blob(package_files(files), payload["project"]["name"] + "-PowerBI.zip", "application/zip")
        return self.write("artifact", {"label": payload["label"], "plan": self.reference(plan),
            "source_digest": payload["source_digest"], "package": package, "build": build, "built": now(),
            "native_runtime": {"state": "awaiting_open_refresh", "note": "Open the project in Power BI and import its actual result export or capture the published model query."}})

    def table_input(self, reference):
        record = self.store.get(reference["kind"], reference["id"], reference.get("revision"))
        if record["kind"] == "dataset":
            metadata = record["payload"]["file"]
        elif record["kind"] == "capture":
            metadata = record["payload"]["csv"]
        else:
            raise ValueError("Use an imported CSV or a captured Power BI result.")
        return record, metadata

    def comparison_run(self, request):
        left, lfile = self.table_input(request["left"])
        right, rfile = self.table_input(request["right"])
        previous = self.store.get("comparison", request["previous_id"]) if request.get("previous_id") else None
        if previous and previous["payload"]["left_file"]["digest"] != lfile["digest"]:
            raise ValueError("A correction comparison retains its original baseline. Create a separate comparison for a changed baseline.")
        spec = copy.deepcopy(request.get("spec", {}))
        if "null_token" not in spec:
            spec.setdefault("left_null_token", left["payload"].get("null_token"))
            spec.setdefault("right_null_token", right["payload"].get("null_token"))
        result = compare_outputs(self.store.bytes(lfile["digest"]), self.store.bytes(rfile["digest"]), spec)
        return self.write("comparison", {"label": text(request.get("label", "Output comparison"), 300),
            "left": self.reference(left), "right": self.reference(right), "left_file": lfile, "right_file": rfile,
            "result": result, "parameters": request.get("parameters", {}), "scope": text(request.get("scope")),
            "artifact": request.get("artifact"), "previous": self.reference(previous) if previous else None,
            "note": text(request.get("note")), "compared": now()})

    def capture_run(self, request):
        if request.get("artifact"):
            artifact = self.store.get("artifact", request["artifact"]["id"], request["artifact"].get("revision"))
            request["artifact"] = self.reference(artifact)
        return self.write("capture", capture_results(self.store, request))

    def usage_import(self, request):
        data, filename = decoded_file(request)
        headers, rows = read_csv(data)
        mapping = request.get("columns") or {"source_id": "source_id", "runs": "runs", "period": "period"}
        if any(column not in headers for column in mapping.values()):
            raise ValueError("Map usage fields to actual input CSV headers.")
        if "source_id" not in mapping or "runs" not in mapping:
            raise ValueError("Map at least source_id and runs.")
        sources = {s["id"]: s for s in self.store.list("source", 10000)}
        matched, unmatched = [], []
        for number, row in enumerate(rows, 2):
            source_id = row[mapping["source_id"]]
            runs = int(row[mapping["runs"]])
            if runs < 0:
                raise ValueError(f"Usage row {number} has a negative run count.")
            item = {"row": number, "source_id": source_id, "runs": runs,
                    **{k: row[v] for k, v in mapping.items() if k not in {"source_id", "runs"}}}
            if source_id in sources:
                item["source"] = self.reference(sources[source_id])
                matched.append(item)
            else:
                unmatched.append(item)
        return self.write("usage", {"label": text(request.get("label", filename), 300),
            "file": self.store.blob(data, filename, "text/csv"), "columns": mapping, "matched": matched,
            "unmatched": unmatched, "matched_rows": len(matched), "unmatched_rows": len(unmatched),
            "period": text(request.get("period"), 200), "imported": now()})

    def support_save(self, request):
        existing = self.store.get("support", request["id"]) if request.get("id") else None
        original = existing["payload"] if existing else {}
        payload = {**original, **{key: text(request.get(key, original.get(key, "")), 50000 if key in {"description", "resolution"} else 500)
                   for key in ("label", "owner", "severity", "state", "due", "description", "resolution", "customer")}}
        if not payload["label"]:
            raise ValueError("Enter a support case title.")
        payload["state"] = payload["state"] or "open"
        payload["severity"] = payload["severity"] or "normal"
        if payload["state"] not in {"open", "in_progress", "waiting_customer", "resolved", "closed"}:
            raise ValueError("Choose a supported case state.")
        references = request.get("references", original.get("references", []))
        payload["references"] = [self.reference(self.store.get(r["kind"], r["id"], r.get("revision"))) for r in references]
        payload["opened"] = original.get("opened", now())
        payload["updated"] = now()
        return self.write("support", payload, existing["id"] if existing else None, request.get("expected", 0))

    def delivery_build(self, request):
        artifact = self.store.get("artifact", request["artifact_id"], request.get("artifact_revision"))
        plan = self.store.get("plan", artifact["payload"]["plan"]["id"], artifact["payload"]["plan"]["revision"])
        source = self.store.get("source", plan["payload"]["source"]["id"], plan["payload"]["source"]["revision"])
        files = {"records/artifact.json": encoded(artifact).encode(), "records/plan.json": encoded(plan).encode(),
                 "records/source.json": encoded(source).encode(),
                 "native/" + artifact["payload"]["package"]["name"]: self.store.bytes(artifact["payload"]["package"]["digest"]),
                 "original/" + source["payload"]["original"]["name"]: self.store.bytes(source["payload"]["original"]["digest"])}
        for table, binding in plan["payload"]["bindings"].items():
            if binding.get("kind") == "csv":
                files["data/" + native.file_name(table) + ".csv"] = self.store.bytes(binding["digest"])
        comparisons = []
        for entity_id in request.get("comparison_ids", []):
            record = self.store.get("comparison", entity_id)
            comparisons.append(self.reference(record))
            files["comparisons/" + entity_id + ".json"] = encoded(record).encode()
            files["comparisons/" + entity_id + "-baseline.csv"] = self.store.bytes(record["payload"]["left_file"]["digest"])
            files["comparisons/" + entity_id + "-target.csv"] = self.store.bytes(record["payload"]["right_file"]["digest"])
        cases = [self.store.get("support", entity_id) for entity_id in request.get("support_ids", [])]
        files["records/support.json"] = encoded(cases).encode()
        files["OPEN_FIRST.txt"] = (
            "Commons BI migration handoff\n\nExtract the ZIP in native/ and run OPEN_POWER_BI.ps1 on Windows, or run "
            "python prepare_project.py before opening the PBIP file. Refresh, open each report page, and retain its actual "
            "output export. records/ contains the exact source, plan revision, original review findings and decisions. "
            "comparisons/ contains complete original and corrected report outputs, row comparisons and parameters. "
            "Native JSON schema validation is recorded separately from Power BI runtime execution. "
            "Support cases and their referenced versions are in records/support.json.\n\n" + text(request.get("notes"), 50000)
        ).encode()
        manifest = {"format": "commons-bi-handoff/1", "created": now(), "artifact": self.reference(artifact),
                    "comparisons": comparisons, "files": [
                        {"path": path, "bytes": len(data), "sha256": digest(data)} for path, data in sorted(files.items())]}
        files["MANIFEST.json"] = encoded(manifest).encode()
        package = self.store.blob(package_files(files), plan["payload"]["project"]["name"] + "-Handoff.zip", "application/zip")
        return self.write("delivery", {"label": text(request.get("label", plan["payload"]["label"] + " handoff"), 300),
            "artifact": self.reference(artifact), "package": package, "files": len(files), "comparisons": comparisons,
            "support": [self.reference(c) for c in cases], "notes": text(request.get("notes"), 50000)})

    def backup_create(self, request):
        # Export files are outside the immutable object set, so backups never embed prior backups.
        self.sql.prepare_backup()
        exports = self.store.root / "exports"
        exports.mkdir(exist_ok=True, mode=0o700)
        filename = "workspace-" + self.operation_id + ".bi-backup"
        result = archive.backup(self.store, exports / filename, request["password"])
        result.pop("path", None)
        return self.write("backup", {"label": text(request.get("label", "Encrypted workspace backup"), 300),
                                     "file": filename, **result})

    def example_load(self, request):
        from .example import load_example
        return load_example(self, bool(request.get("build", True)))["record"]

    def preview(self, kind, entity_id, revision=None, offset=0, limit=100, search=""):
        record, file = self.table_input({"kind": kind, "id": entity_id, "revision": revision})
        headers, rows = read_csv(self.store.bytes(file["digest"]))
        offset, limit = max(0, int(offset)), min(500, max(1, int(limit)))
        indexed = list(enumerate(rows, 1))
        if search:
            needle = str(search).casefold()
            indexed = [(number, row) for number, row in indexed if any(needle in v.casefold() for v in row.values())]
        selected = indexed[offset:offset + limit]
        return {"record": self.reference(record), "columns": headers, "rows": [row for _, row in selected],
                "row_numbers": [number for number, _ in selected], "total": len(indexed), "source_rows": len(rows),
                "offset": offset, "file": file}

    def export_file(self, entity_id):
        record = self.store.get("backup", entity_id)
        path = self.store.root / "exports" / Path(record["payload"]["file"]).name
        data = path.read_bytes()
        if digest(data) != record["payload"]["sha256"]:
            raise ValueError("The encrypted backup differs from its saved content.")
        return data, path.name

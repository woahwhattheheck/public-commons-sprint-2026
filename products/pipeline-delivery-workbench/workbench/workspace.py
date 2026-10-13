"""Durable project authoring, native operation intentions, and client handover."""
from __future__ import annotations
import base64, contextlib, json, os, sqlite3, sys, threading, uuid
from pathlib import Path
from common import (SCHEMA, MAX_PROJECT, FileLease, Problem, clone, decode_file, identifier,
                    native_available, packed, path_name, project_path, sha, text_value, utc)
from artifacts import compare_manifests

MUTATIONS = {
    "project.create", "project.update", "edition.save", "contract.save", "binding.save",
    "run.execute", "run.start", "run.reconcile", "run.cancel", "run.retry",
    "comparison.create", "review.save", "release.create",
}
COMMANDS = {"parse", "build", "run", "seed", "compile", "source freshness", "docs generate"}

class Workspace:
    def __init__(self, root, *, source_root=None):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.source_root = Path(source_root or Path(__file__).parent).resolve()
        self.lock = threading.RLock()
        # One existing writer lock covers commit, launch admission, and selected-writer detachment.
        self.operation_lock = self.lock
        try: self.lease = FileLease(self.root / "workspace.lock")
        except BlockingIOError as exc:
            raise Problem("workspace_in_use", "This workspace already has its own open operator", 409) from exc
        self.db = sqlite3.connect(self.root / "workspace.sqlite", check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),workspace_id TEXT NOT NULL,schema TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS entities(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL UNIQUE,project_id TEXT,body TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS entities_kind_project ON entities(kind,project_id,seq);
        CREATE TABLE IF NOT EXISTS blobs(sha256 TEXT PRIMARY KEY,bytes INTEGER NOT NULL,body BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS requests(request_id TEXT PRIMARY KEY,action TEXT NOT NULL,digest TEXT NOT NULL,answer TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,revision INTEGER NOT NULL,action TEXT NOT NULL,request_id TEXT,record_id TEXT,at TEXT NOT NULL);
        """)
        row = self.db.execute("SELECT * FROM state WHERE id=1").fetchone()
        if row is None:
            self.db.execute("INSERT INTO state VALUES(1,?,?,0,?)", (str(uuid.uuid4()), SCHEMA, utc()))
        elif row["schema"] != SCHEMA:
            self.close()
            raise Problem("unsupported_workspace", "This is not a supported pipeline delivery workspace", 409)
        self._runtime = None

    def close(self):
        with getattr(self, "lock", contextlib.nullcontext()):
            if getattr(self, "_runtime", None):
                self._runtime.close()
            if getattr(self, "db", None):
                self.db.close(); self.db = None
            if getattr(self, "lease", None):
                self.lease.close(); self.lease = None

    def meta(self):
        row = self.db.execute("SELECT * FROM state WHERE id=1").fetchone()
        return {"workspace_id": row["workspace_id"], "schema": row["schema"],
                "revision": row["revision"], "created_at": row["created_at"]}

    def _body(self, kind, record_id):
        row = self.db.execute("SELECT body FROM entities WHERE kind=? AND id=?", (kind, record_id)).fetchone()
        if not row:
            raise Problem("record_missing", "The selected " + kind + " does not exist", 404, {"id": record_id})
        return json.loads(row["body"])

    def _put(self, kind, body, project_id=None):
        body = clone(body)
        body.setdefault("id", kind.replace("_", "-") + "-" + uuid.uuid4().hex)
        body.setdefault("created_at", utc())
        body.setdefault("project_id", project_id)
        self.db.execute("INSERT INTO entities(kind,id,project_id,body,created_at) VALUES(?,?,?,?,?)",
                        (kind, body["id"], project_id, packed(body), body["created_at"]))
        return body

    def _replace(self, kind, body):
        self.db.execute("UPDATE entities SET body=? WHERE kind=? AND id=?", (packed(body), kind, body["id"]))

    def _list(self, kind, project_id=None, *, limit=100, offset=0):
        limit, offset = int(limit), int(offset)
        if limit < 1 or limit > 200 or offset < 0:
            raise Problem("invalid_page", "Use a limit from 1 to 200 and a nonnegative offset")
        where, args = "kind=?", [kind]
        if project_id is not None:
            where += " AND project_id=?"; args.append(project_id)
        total = self.db.execute("SELECT COUNT(*) FROM entities WHERE " + where, args).fetchone()[0]
        rows = self.db.execute("SELECT body FROM entities WHERE " + where + " ORDER BY seq DESC LIMIT ? OFFSET ?", args + [limit, offset]).fetchall()
        return {"items": [json.loads(x["body"]) for x in rows], "total": total,
                "offset": offset, "next_offset": offset + len(rows) if offset + len(rows) < total else None}

    def _store_blob(self, data):
        digest = sha(data)
        old = self.db.execute("SELECT bytes,body FROM blobs WHERE sha256=?", (digest,)).fetchone()
        if old and (old["bytes"] != len(data) or bytes(old["body"]) != data):
            raise Problem("source_collision", "Retained source bytes do not match their identity", 409)
        self.db.execute("INSERT OR IGNORE INTO blobs VALUES(?,?,?)", (digest, len(data), data))
        return {"sha256": digest, "bytes": len(data)}

    def blob(self, digest):
        row = self.db.execute("SELECT bytes,body FROM blobs WHERE sha256=?", (digest,)).fetchone()
        if not row:
            raise Problem("source_missing", "A retained source file is missing", 409, {"sha256": digest})
        data = bytes(row["body"])
        if sha(data) != digest or len(data) != row["bytes"]:
            raise Problem("source_changed", "Retained source bytes failed their identity check", 409)
        return data

    def snapshot(self):
        with self.lock:
            return {**self.meta(), "projects": self._list("project"),
                    "native_available": native_available(self.root),
                    "runs": self._list("run", limit=50),
                    "releases": self._list("release", limit=30)}

    def invoke(self, action, payload=None, *, workspace_id=None, expected_revision=None, request_id=None):
        with self.operation_lock:
            return self._invoke(action, payload, workspace_id=workspace_id, expected_revision=expected_revision, request_id=request_id)

    def _invoke(self, action, payload=None, *, workspace_id=None, expected_revision=None, request_id=None):
        if not isinstance(action, str) or not isinstance(payload or {}, dict):
            raise Problem("invalid_request", "An action and object payload are required")
        payload = payload or {}
        if action not in MUTATIONS:
            with self.lock:
                return {"action": action, **self.meta(), "result": self._read(action, payload)}
        identifier(request_id, "request_id")
        identity = sha(packed({"action": action, "payload": payload, "workspace_id": workspace_id,
                               "expected_revision": expected_revision}))
        after = None
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                old = self.db.execute("SELECT * FROM requests WHERE request_id=?", (request_id,)).fetchone()
                if old:
                    if old["action"] != action or old["digest"] != identity:
                        raise Problem("request_conflict", "That request ID already names different work", 409)
                    answer = json.loads(old["answer"])
                    self.db.execute("COMMIT")
                    return {**answer, "replayed": True}
                meta = self.meta()
                if workspace_id != meta["workspace_id"]:
                    raise Problem("workspace_changed", "Reload the currently selected workspace", 409, meta)
                if type(expected_revision) is not int or expected_revision != meta["revision"]:
                    raise Problem("revision_changed", "The workspace changed; reload before applying this draft", 409, meta)
                result, after = self._mutate(action, payload, request_id)
                revision = meta["revision"] + 1
                self.db.execute("UPDATE state SET revision=? WHERE id=1", (revision,))
                answer = {"action": action, "request_id": request_id, "workspace_id": meta["workspace_id"],
                          "revision": revision, "result": result, "replayed": False}
                self.db.execute("INSERT INTO requests VALUES(?,?,?,?,?)", (request_id, action, identity, packed(answer), utc()))
                self.db.execute("INSERT INTO audit(revision,action,request_id,record_id,at) VALUES(?,?,?,?,?)",
                                (revision, action, request_id, result.get("id") if isinstance(result, dict) else None, utc()))
                self.db.execute("COMMIT")
            except BaseException:
                if self.db.in_transaction: self.db.execute("ROLLBACK")
                raise
        if after:
            # Accepted request remains replayable even if native launch fails or the caller loses its response.
            try:
                self.runtime().submit(after["action"], after["run_id"])
            except Exception:
                # COMMIT already retained this exact acceptance. A storage/launch failure cannot turn
                # it into a different HTTP receipt; native control remains explicit and replayable.
                pass
        return answer

    def _read(self, action, p):
        if action == "workspace.get": return self.snapshot()
        if action == "request.get":
            identifier(p.get("request_id"), "request_id")
            row = self.db.execute("SELECT answer FROM requests WHERE request_id=?", (p["request_id"],)).fetchone()
            return json.loads(row["answer"]) if row else None
        if action == "records.list":
            if p.get("kind") not in {"project", "edition", "contract", "binding", "run", "comparison", "review", "release"}:
                raise Problem("invalid_kind", "Select a known record kind")
            return self._list(p["kind"], p.get("project_id"), limit=p.get("limit", 100), offset=p.get("offset", 0))
        if action == "project.get":
            project = self._body("project", p["id"])
            return {"project": project, "edition": self._body("edition", project["edition_id"]) if project.get("edition_id") else None,
                    "contract": self._body("contract", project["contract_id"]) if project.get("contract_id") else None,
                    "binding": self._body("binding", project["binding_id"]) if project.get("binding_id") else None,
                    "editions": self._list("edition", project["id"]), "contracts": self._list("contract", project["id"]),
                    "runs": self._list("run", project["id"]), "reviews": self._list("review", project["id"]),
                    "comparisons": self._list("comparison", project["id"]), "releases": self._list("release", project["id"])}
        if action in {"edition.get", "contract.get", "binding.get", "run.get", "comparison.get", "review.get", "release.get"}:
            kind = action.split(".")[0]
            body = self._body(kind, p["id"])
            if kind == "run": body = self._run_view(body)
            return body
        if action == "file.read":
            edition = self._body("edition", p["edition_id"])
            name = path_name(p["path"])
            selected = next((x for x in edition["files"] if x["path"] == name), None)
            if not selected: raise Problem("file_missing", "That file is absent from the selected edition", 404)
            data = self.blob(selected["sha256"])
            try: content = data.decode("utf-8")
            except UnicodeDecodeError: content = None
            return {**selected, "content": content, "content_base64": base64.b64encode(data).decode("ascii")}
        if action == "run.log":
            return self.runtime().logs(p["id"], offset=p.get("offset", 0), limit=p.get("limit", 65536))
        if action == "run.artifact":
            return self.runtime().artifact(p["id"], p["path"])
        if action == "edition.diff":
            return self._edition_diff(p["before_id"], p["after_id"])
        if action == "audit.list":
            offset, limit = int(p.get("offset", 0)), min(200, max(1, int(p.get("limit", 100))))
            rows = self.db.execute("SELECT * FROM audit ORDER BY seq DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
            return {"items": [dict(r) for r in rows], "next_offset": offset + len(rows) if len(rows) == limit else None}
        if action == "runtime.get":
            return self.runtime().status()
        raise Problem("unknown_action", "Unknown action: " + action, 404)

    def _mutate(self, action, p, request_id):
        if action == "project.create":
            result = self._put("project", {"label": text_value(p.get("label"), "label", 200, True),
                "description": text_value(p.get("description", ""), "description"), "edition_id": None,
                "contract_id": None, "binding_id": None, "updated_at": utc()})
            result["project_id"] = result["id"]; self._replace("project", result)
            return result, None
        if action == "project.update":
            result = self._body("project", p["id"])
            result.update(label=text_value(p.get("label", result["label"]), "label", 200, True),
                          description=text_value(p.get("description", result["description"]), "description"),
                          updated_at=utc())
            self._replace("project", result); return result, None
        if action == "edition.save": return self._edition_save(p), None
        if action == "contract.save": return self._contract_save(p), None
        if action == "binding.save": return self._binding_save(p), None
        if action == "run.execute":
            result = self._new_run(p, request_id)
            return result, {"action": "start", "run_id": result["id"]}
        if action in {"run.start", "run.reconcile", "run.cancel"}:
            result = self._body("run", p["id"])
            if action == "run.start" and result["state"] not in {"prepared", "setup_failed"}:
                raise Problem("run_not_dispatchable", "This operation must be reconciled or explicitly retried", 409, {"state": result["state"]})
            return {"id": result["id"], "accepted_action": action, "state": result["state"]}, {"action": action.split(".")[1], "run_id": result["id"]}
        if action == "run.retry":
            old = self._body("run", p["id"])
            if old["state"] not in {"failed", "cancelled"}:
                raise Problem("run_not_retryable", "Only a definite completed failure can start an explicit new run", 409)
            result = self._new_run({"project_id": old["project_id"], "edition_id": old["edition_id"],
                                  "contract_id": old["contract_id"], "binding_id": p.get("binding_id", old["binding_id"]),
                                  "parent_run_id": old["id"], "base_run_id": old.get("base_run_id")}, request_id)
            return result, {"action": "start", "run_id": result["id"]}
        if action == "comparison.create":
            a, b = self._body("run", p["before_run_id"]), self._body("run", p["after_run_id"])
            if a["project_id"] != b["project_id"]:
                raise Problem("different_projects", "Compare runs of the same client project")
            am, bm = self._run_manifest(a), self._run_manifest(b)
            result = self._put("comparison", {"label": text_value(p.get("label"), "label", 200, True),
                "before_run_id": a["id"], "after_run_id": b["id"], "before_edition_id": a["edition_id"],
                "after_edition_id": b["edition_id"], "before_manifest_sha256": sha(packed(am)),
                "after_manifest_sha256": sha(packed(bm)), "comparison": compare_manifests(am, bm),
                "source_diff": self._edition_diff(a["edition_id"], b["edition_id"])}, a["project_id"])
            return result, None
        if action == "review.save":
            run = self._body("run", p["run_id"])
            if run["state"] not in {"succeeded", "failed", "cancelled"} or not run.get("outcome"):
                raise Problem("run_unfinished", "Retain the original native outcome before reviewing it", 409)
            decision = p.get("decision")
            if decision not in {"approve", "revise"}: raise Problem("invalid_decision", "Choose approve or revise")
            if decision == "approve" and (run["state"] != "succeeded" or not run["outcome"]["evaluation"]["criteria_satisfied"]):
                raise Problem("acceptance_unmet", "Native execution or a required operating criterion has not passed", 409)
            comparison_id = p.get("comparison_id")
            if comparison_id and self._body("comparison", comparison_id)["after_run_id"] != run["id"]:
                raise Problem("comparison_mismatch", "The comparison must end at the reviewed run")
            result = self._put("review", {"run_id": run["id"], "edition_id": run["edition_id"],
                "contract_id": run["contract_id"], "outcome_sha256": run["outcome_sha256"],
                "decision": decision, "reviewer": text_value(p.get("reviewer"), "reviewer", 200, True),
                "comment": text_value(p.get("comment", ""), "comment", 40000),
                "comparison_id": comparison_id}, run["project_id"])
            return result, None
        if action == "release.create":
            review = self._body("review", p["review_id"])
            if review["decision"] != "approve": raise Problem("review_not_approved", "Select an approved review", 409)
            run = self._body("run", review["run_id"])
            if run.get("outcome_sha256") != review["outcome_sha256"]:
                raise Problem("review_changed", "The retained native outcome differs from the reviewed one", 409)
            result = self._put("release", {"label": text_value(p.get("label"), "label", 200, True),
                "review_id": review["id"], "run_id": run["id"], "edition_id": run["edition_id"],
                "contract_id": run["contract_id"], "outcome_sha256": run["outcome_sha256"],
                "operator_notes": text_value(p.get("operator_notes", ""), "operator_notes", 80000)},
                run["project_id"])
            return result, None
        raise Problem("unknown_action", "Unknown mutation")

    def _edition_save(self, p):
        project = self._body("project", p["project_id"])
        base_id = p.get("base_edition_id")
        if base_id != project.get("edition_id"):
            raise Problem("edition_changed", "Save against the current edition; retain your draft while reloading", 409)
        previous = self._body("edition", base_id) if base_id else None
        current = {x["path"]: x for x in previous["files"]} if previous else {}
        changes = p.get("files", [])
        if not isinstance(changes, list) or not isinstance(p.get("delete_paths", []), list):
            raise Problem("invalid_files", "files and delete_paths must be arrays")
        seen = set()
        for entry in changes:
            if not isinstance(entry, dict): raise Problem("invalid_file", "Each file must be an object")
            name = project_path(entry.get("path"))
            if name in seen: raise Problem("duplicate_file", "The same path appears twice")
            seen.add(name)
            raw = decode_file(entry.get("content_base64"))
            current[name] = {"path": name, **self._store_blob(raw)}
        for name in p.get("delete_paths", []):
            project_path(name)
            if name in seen: raise Problem("conflicting_file_edit", "A path cannot be saved and deleted together")
            if name not in current: raise Problem("file_missing", "The deleted file is absent", 404, {"path": name})
            del current[name]
        if "dbt_project.yml" not in current:
            raise Problem("dbt_project_missing", "The edition must contain its original dbt_project.yml")
        if sum(x["bytes"] for x in current.values()) > MAX_PROJECT:
            raise Problem("project_too_large", "The retained source edition exceeds 128 MiB", 413)
        ordered = [current[k] for k in sorted(current)]
        result = self._put("edition", {"label": text_value(p.get("label"), "label", 200, True),
            "parent_edition_id": base_id, "files": ordered, "source_sha256": sha(packed(ordered)),
            "source_notes": text_value(p.get("source_notes", ""), "source_notes", 40000)}, project["id"])
        project.update(edition_id=result["id"], updated_at=utc()); self._replace("project", project)
        return result

    def _contract_save(self, p):
        project = self._body("project", p["project_id"])
        c = clone(p.get("contract", {}))
        if not isinstance(c, dict): raise Problem("invalid_contract", "contract must be an object")
        allowed = {"label", "owner", "purpose", "command", "select", "exclude", "vars", "full_refresh", "fail_fast", "threads", "install_dependencies", "generate_catalog", "expectations", "notes"}
        if set(c) - allowed: raise Problem("unknown_contract_field", "Unknown operating contract fields", details=sorted(set(c)-allowed))
        for name, limit in (("label", 200), ("owner", 200), ("purpose", 10000)):
            c[name] = text_value(c.get(name, ""), name, limit, name in {"label", "owner"})
        c["command"] = c.get("command", "build")
        if c["command"] not in COMMANDS: raise Problem("invalid_command", "Choose a supported original dbt command")
        for name in ("select", "exclude"):
            c[name] = text_value(c.get(name, ""), name, 4000)
        if not isinstance(c.get("vars", {}), dict): raise Problem("invalid_vars", "dbt vars must be a JSON object")
        c["vars"] = c.get("vars", {})
        for name in ("full_refresh", "fail_fast", "install_dependencies", "generate_catalog"):
            if type(c.get(name, False)) is not bool: raise Problem("invalid_option", name + " must be true or false")
            c[name] = c.get(name, False)
        c["threads"] = c.get("threads", 1)
        if type(c["threads"]) is not int or not 1 <= c["threads"] <= 32: raise Problem("invalid_threads", "Use 1 to 32 dbt threads")
        if c["full_refresh"] and c["command"] not in {"build", "run", "seed"}:
            raise Problem("unsupported_full_refresh", "Full refresh applies to build, run, or seed")
        if c["fail_fast"] and c["command"] not in {"build", "run", "seed"}:
            raise Problem("unsupported_fail_fast", "Fail-fast applies to build, run, or seed")
        c["notes"] = text_value(c.get("notes", ""), "notes", 40000)
        expectations = c.get("expectations", [])
        if not isinstance(expectations, list) or len(expectations) > 2000:
            raise Problem("invalid_expectations", "Use an array of at most 2,000 native-node expectations")
        seen = set()
        for item in expectations:
            if not isinstance(item, dict) or set(item) - {"unique_id", "label", "accepted_statuses", "required"}:
                raise Problem("invalid_expectation", "Use unique_id, label, accepted_statuses and required")
            uid = text_value(item.get("unique_id"), "unique_id", 1000, True)
            if uid in seen: raise Problem("duplicate_expectation", "Each native node may appear once")
            seen.add(uid)
            statuses = item.get("accepted_statuses")
            if not isinstance(statuses, list) or not statuses or any(not isinstance(x, str) or not x for x in statuses):
                raise Problem("invalid_statuses", "accepted_statuses must contain original dbt status strings")
            if type(item.get("required", True)) is not bool:
                raise Problem("invalid_expectation", "required must be true or false")
        c["expectations"] = expectations
        result = self._put("contract", {"parent_contract_id": project.get("contract_id"),
                           "contract": c, "contract_sha256": sha(packed(c))}, project["id"])
        project.update(contract_id=result["id"], updated_at=utc()); self._replace("project", project)
        return result

    def _binding_save(self, p):
        project = self._body("project", p["project_id"])
        binding = clone(p.get("binding", {}))
        allowed = {"label", "mode", "python_executable", "dbt_executable", "profiles_dir", "target"}
        if not isinstance(binding, dict) or set(binding) - allowed:
            raise Problem("invalid_binding", "Use the documented installed-runtime and profile references")
        binding["label"] = text_value(binding.get("label", "Local DuckDB"), "label", 200, True)
        mode = binding.get("mode", "managed_duckdb")
        if mode not in {"managed_duckdb", "external_profiles"}: raise Problem("invalid_binding", "Choose managed_duckdb or external_profiles")
        binding["mode"] = mode
        for key, default in (("python_executable", sys.executable), ("dbt_executable", "dbt"), ("target", "local")):
            binding[key] = text_value(binding.get(key, default), key, 4096, True)
        if mode == "external_profiles":
            binding["profiles_dir"] = text_value(binding.get("profiles_dir"), "profiles_dir", 4096, True)
        else: binding.pop("profiles_dir", None)
        result = self._put("binding", {"binding": binding, "binding_sha256": sha(packed(binding))}, project["id"])
        project.update(binding_id=result["id"], updated_at=utc()); self._replace("project", project)
        return result

    def _new_run(self, p, request_id):
        project = self._body("project", p["project_id"])
        selected = {}
        for kind in ("edition", "contract", "binding"):
            record = self._body(kind, p.get(kind + "_id") or project.get(kind + "_id"))
            if record["project_id"] != project["id"]:
                raise Problem("selection_mismatch", "All selected records must belong to this client project")
            selected[kind] = record
        base_id = p.get("base_run_id")
        if base_id:
            base = self._body("run", base_id)
            if base["project_id"] != project["id"] or base["state"] != "succeeded":
                raise Problem("invalid_base_run", "Select a successful run of this project as the data baseline")
            if selected["binding"]["binding"]["mode"] != "managed_duckdb" or self._body("binding", base["binding_id"])["binding"]["mode"] != "managed_duckdb":
                raise Problem("invalid_base_run", "Only a retained managed DuckDB database can be copied as the baseline")
        result = self._put("run", {"request_id": request_id, "edition_id": selected["edition"]["id"],
            "contract_id": selected["contract"]["id"], "binding_id": selected["binding"]["id"],
            "source_sha256": selected["edition"]["source_sha256"],
            "contract_sha256": selected["contract"]["contract_sha256"],
            "binding_sha256": selected["binding"]["binding_sha256"],
            "base_run_id": base_id, "parent_run_id": p.get("parent_run_id"),
            "state": "prepared", "dagster_run_id": str(uuid.uuid4()),
            "request_dispatched": False, "outcome": None, "outcome_sha256": None,
            "updated_at": utc()}, project["id"])
        return result

    def _run_manifest(self, run):
        path = self.root / "native-runs" / run["id"] / "artifacts" / "manifest.json"
        entry = next((x for x in (run.get("outcome") or {}).get("evaluation", {}).get("artifact_files", []) if x["path"] == "manifest.json"), None)
        if not entry or not path.is_file(): raise Problem("manifest_missing", "The selected run has no retained native manifest", 409)
        raw = path.read_bytes()
        if sha(raw) != entry["sha256"] or len(raw) != entry["bytes"]:
            raise Problem("manifest_changed", "The native manifest differs from the retained outcome", 409)
        return json.loads(raw)

    def _edition_diff(self, before_id, after_id):
        a, b = self._body("edition", before_id), self._body("edition", after_id)
        if a["project_id"] != b["project_id"]: raise Problem("different_projects", "Compare editions of the same project")
        af, bf = {x["path"]: x for x in a["files"]}, {x["path"]: x for x in b["files"]}
        return {"before_id": before_id, "after_id": after_id, "files": [
            {"path": p, "kind": "added" if p not in af else "removed" if p not in bf else "changed",
             "before": af.get(p), "after": bf.get(p)} for p in sorted(af.keys() | bf.keys()) if af.get(p) != bf.get(p)]}

    def _run_view(self, body):
        result = clone(body)
        result["native_available"] = native_available(self.root)
        result["can_start"] = body["state"] in {"prepared", "setup_failed"} and not body.get("request_dispatched") and self.runtime()._belongs_here(body["id"])
        result["can_retry"] = body["state"] in {"failed", "cancelled"}
        result["can_reconcile"] = body["state"] not in {"prepared"}
        return result

    def runtime(self):
        if self._runtime is None:
            from native import Runtime
            self._runtime = Runtime(self)
        return self._runtime

    def native_update(self, run_id, update, *, event):
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                run = self._body("run", run_id)
                if all(run.get(key) == value for key, value in update.items()):
                    self.db.execute("COMMIT")
                    return run
                if run.get("outcome") and update.get("outcome") and packed(run["outcome"]) != packed(update["outcome"]):
                    raise Problem("outcome_conflict", "A completed native outcome cannot be replaced", 409)
                run.update(clone(update)); run["updated_at"] = utc()
                self._replace("run", run)
                rev = self.meta()["revision"] + 1
                self.db.execute("UPDATE state SET revision=? WHERE id=1", (rev,))
                self.db.execute("INSERT INTO audit(revision,action,record_id,at) VALUES(?,?,?,?)", (rev, event, run_id, utc()))
                self.db.execute("COMMIT")
                return run
            except BaseException:
                if self.db.in_transaction: self.db.execute("ROLLBACK")
                raise

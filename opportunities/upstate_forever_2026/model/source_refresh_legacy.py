"""Saved, dependency-aware source replacement for the original Workspace.

A refresh never rewrites a source edition or a previous result. Unaffected native
selections keep their exact IDs and provenance. Changed selections are derived
through Workspace's existing writers and execution path.

Copyright TokenJunkieLabs. Standard library only; scientific work is delegated.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from contextlib import closing
import csv
from dataclasses import dataclass
import html
import io
import json
import sqlite3
from pathlib import Path
from typing import Any, Callable, Mapping

from .common import (canonical, digest, held, identifier, now, read_json, verify_file)

PLAN_KIND = "source-refresh-plans"
STATE_SCHEMA = "upstate.source-refresh-state/v1"
VERSION = 1
# Anything not known to be descriptive is conservatively interpretation-changing.
DESCRIPTIVE = frozenset({"id", "title", "uri", "vintage", "notes", "description",
                         "captured_at", "license", "attribution", "citation"})
BODY_KEYS = ("sha256", "bytes")
NATIVE_KINDS = ("grids", "profiles", "scenarios", "runs")


@dataclass
class RefreshResult:
    plan: dict[str, Any]
    state: dict[str, Any]


class SourceRefresh:
    """Operate on an already-open original ``model.workspace.Workspace``."""

    def __init__(self, workspace):
        self.ws = workspace
        self.root = workspace.root

    @staticmethod
    def _entries(collection):
        result = {}
        for entry in collection["entries"]:
            key = entry["id"]
            if key in result:
                raise ValueError("Duplicate source ID: " + key)
            result[key] = entry
        return result

    @staticmethod
    def _fingerprint(entry):
        """Native relative sidecar paths matter; capture-machine paths do not."""
        def body(record):
            return {**{key: record[key] for key in BODY_KEYS},
                    "native_path": record.get("view_path", record["filename"])}
        return {"body": body(entry["body"]),
                "companions": sorted((body(x) for x in entry.get("companions", [])),
                                     key=lambda x: x["native_path"]),
                "interpretation": {k: v for k, v in entry.items()
                                   if k not in DESCRIPTIVE | {"body", "companions"}}}

    def _verify_sources(self, collection, checked):
        # Original manifest and every retained original, including unrelated files,
        # are verified once per operation. No source view/hardlink creation needed.
        records = [collection["original_manifest"]]
        for entry in collection["entries"]:
            records.extend([entry["body"], *entry.get("companions", [])])
        for record in records:
            signature = (record["object"], record["sha256"], record["bytes"])
            if signature not in checked:
                verify_file(self.root, {**record, "path": record["object"]})
                checked.add(signature)

    def source_diff(self, old_id: str, new_id: str,
                    mapping: Mapping[str, str] | None = None, *, verify=True):
        old = self.ws._get("sources", identifier(old_id))
        new = self.ws._get("sources", identifier(new_id))
        if verify:
            checked = set()
            self._verify_sources(old, checked)
            self._verify_sources(new, checked)
        before, after = self._entries(old), self._entries(new)
        mapping = dict(mapping or {})
        if any(not isinstance(k, str) or not isinstance(v, str) or not v
               for k, v in mapping.items()):
            raise ValueError("Source mappings must be nonempty source-ID strings")
        unknown = set(mapping) - set(before)
        if unknown:
            raise ValueError("Mapping refers to unknown old sources: " + ", ".join(sorted(unknown)))
        missing = set(mapping.values()) - set(after)
        if missing:
            raise ValueError("Mapping refers to unknown replacement sources: " + ", ".join(sorted(missing)))
        rows, selected = [], set()
        for name, entry in sorted(before.items()):
            target = mapping.get(name, name)
            replacement = after.get(target)
            if replacement is None:
                change, reason = "removed", "No corresponding source in the replacement edition"
            else:
                selected.add(target)
                first, second = self._fingerprint(entry), self._fingerprint(replacement)
                if first != second:
                    change = "changed"
                    changed_parts = [key for key in first if first[key] != second[key]]
                    reason = "Changed " + ", ".join(changed_parts)
                elif entry != replacement:
                    change, reason = "metadata", "Same native inputs and interpretation; provenance-only update"
                else:
                    change, reason = "unchanged", "Same retained source and interpretation"
            rows.append({"source_id": name, "replacement_id": target if replacement else None,
                         "change": change, "reason": reason,
                         "before": entry, "after": replacement})
        for name in sorted(set(after) - selected):
            rows.append({"source_id": None, "replacement_id": name, "change": "added",
                         "reason": "New source; no existing selection depends on it",
                         "before": None, "after": after[name]})
        return {"from_collection_id": old_id, "to_collection_id": new_id,
                "mapping": mapping, "changes": rows,
                "counts": dict(Counter(row["change"] for row in rows))}

    def _native(self, kind: str, key: str):
        identifier(key)
        if kind in ("profiles", "scenarios"):
            return self.ws._get(kind, key)
        if kind == "grids":
            return self.ws.get_grid(key)
        if kind == "runs":
            return self.ws.inspect_run(key)
        raise ValueError("Unknown native selection type: " + kind)

    @staticmethod
    def _selection(kind, value):
        if kind == "grids":
            return deepcopy(value["spec"])
        if kind == "runs":
            return deepcopy(value["selection"])
        return {k: deepcopy(v) for k, v in value.items()
                if k not in {"id", "schema", "table_summary"}}

    @staticmethod
    def _source_refs(kind, payload):
        if kind == "grids":
            result = [("input_sources." + role, value)
                      for role, value in sorted(payload["input_sources"].items())]
            result.extend((field + ".source_id", payload[field]["source_id"])
                          for field in ("reporting_area", "model_domain"))
            return result
        if kind == "profiles":
            return [("biophysical_source_id", payload["biophysical_source_id"])]
        if kind == "scenarios":
            return [(f"patches.{i}.mask_source_id", patch["mask_source_id"])
                    for i, patch in enumerate(payload.get("patches", []))]
        return []

    @staticmethod
    def _assign(payload, path, value):
        parts, current = path.split("."), payload
        for part in parts[:-1]:
            current = current[int(part)] if isinstance(current, list) else current[part]
        key = int(parts[-1]) if isinstance(current, list) else parts[-1]
        current[key] = value

    def _roots(self, old_id, roots):
        if roots is not None:
            if not isinstance(roots, dict) or set(roots) - set(NATIVE_KINDS):
                raise ValueError("Roots must map grids/profiles/scenarios/runs to native IDs")
            result = {}
            for kind, ids in roots.items():
                if not isinstance(ids, list):
                    raise ValueError("Root IDs must be lists")
                result[kind] = sorted(set(identifier(key) for key in ids))
            return result
        result = {kind: [] for kind in NATIVE_KINDS}
        # Select all native editions referencing the old collection, plus all runs
        # built from them, not merely the latest run or the visible first page.
        for kind in ("profiles", "scenarios"):
            result[kind] = [v["id"] for v in self.ws._list(kind)
                            if v.get("source_collection_id") == old_id]
        for path in sorted((self.root / "grids").glob("*/grid.json")):
            value = read_json(path)
            if value.get("spec", {}).get("source_collection_id") == old_id:
                result["grids"].append(identifier(value["id"]))
        affected = {kind: set(ids) for kind, ids in result.items()}
        for path in sorted((self.root / "runs").glob("*/run.json")):
            value = read_json(path)
            selection = value.get("selection", {})
            if any(selection.get(field) in affected[kind]
                   for field, kind in (("grid_id", "grids"), ("profile_id", "profiles"),
                                       ("scenario_id", "scenarios"))):
                result["runs"].append(identifier(value["id"]))
        return {kind: sorted(set(ids)) for kind, ids in result.items()}

    def _plan_value(self, old_id: str, new_id: str, *, mapping=None, roots=None,
                    title="Source refresh") -> dict:
        """Read the original dependency graph without writing a plan or checkpoint."""
        changes = self.source_diff(old_id, new_id, mapping)
        roots = self._roots(old_id, roots)
        diff = {row["source_id"]: row for row in changes["changes"] if row["source_id"] is not None}
        nodes, visiting = {}, set()

        def add(kind, key):
            node_key = kind + "/" + identifier(key)
            if node_key in nodes:
                return node_key
            if node_key in visiting:
                raise ValueError("Cycle in native source dependency graph")
            visiting.add(node_key)
            value = self._native(kind, key)
            payload = self._selection(kind, value)
            node = {"key": node_key, "kind": kind, "old_id": key,
                    "selection": payload, "dependencies": [], "source_references": [],
                    "action": "reuse", "reasons": []}
            if kind == "runs":
                for field, depkind in (("grid_id", "grids"), ("profile_id", "profiles"),
                                       ("scenario_id", "scenarios")):
                    dep = add(depkind, payload[field])
                    node["dependencies"].append({"field": field, "key": dep})
                actions = [nodes[d["key"]]["action"] for d in node["dependencies"]]
                if "missing" in actions:
                    node["action"] = "missing"
                elif "derive" in actions:
                    node["action"] = "derive"
                node["reasons"] = ["Affected " + d["field"] for d in node["dependencies"]
                                   if nodes[d["key"]]["action"] != "reuse"]
            elif payload.get("source_collection_id") == old_id:
                touched, missing = [], []
                for field, source in self._source_refs(kind, payload):
                    row = diff.get(source)
                    if row is None:
                        raise ValueError("Native selection references unknown old source: " + source)
                    ref = {"field": field, "source_id": source,
                           "replacement_id": row["replacement_id"], "change": row["change"]}
                    node["source_references"].append(ref)
                    if row["change"] == "removed":
                        missing.append(source)
                    if row["change"] == "changed":
                        touched.append(source)
                if missing:
                    node["action"] = "missing"
                    node["reasons"] = ["Map missing source: " + s for s in sorted(set(missing))]
                elif touched:
                    node["action"] = "derive"
                    node["reasons"] = ["Changed input: " + s for s in sorted(set(touched))]
            if not node["reasons"]:
                node["reasons"] = ["All selected native inputs are unaffected; preserve original ID and provenance"]
            nodes[node_key] = node
            visiting.remove(node_key)
            return node_key

        selected_roots = []
        for kind in NATIVE_KINDS:
            selected_roots.extend(add(kind, key) for key in roots.get(kind, []))
        payload = {"version": VERSION, "title": str(title),
                   "workspace_id": self.ws.project["id"],
                   "from_collection_id": old_id, "to_collection_id": new_id,
                   "mapping": changes["mapping"], "changes": changes["changes"],
                   "source_counts": changes["counts"], "roots": sorted(set(selected_roots)),
                   "nodes": list(nodes.values())}
        return payload

    def plan(self, old_id: str, new_id: str, *, mapping=None, roots=None,
             title="Source refresh") -> dict:
        payload = self._plan_value(old_id, new_id, mapping=mapping, roots=roots, title=title)
        with held(self.root / ".source-refresh-plan.lock"):
            return self.ws._save(PLAN_KIND, payload)

    def get(self, plan_id: str):
        plan = self.ws._get(PLAN_KIND, identifier(plan_id))
        if plan.get("version") != VERSION:
            raise ValueError("Unsupported source-refresh plan version")
        if plan["workspace_id"] != self.ws.project["id"]:
            raise ValueError("Refresh plan belongs to another original workspace")
        return plan

    def _state_path(self, plan_id):
        return self.root / "source-refreshes" / identifier(plan_id) / "state.sqlite3"

    def state(self, plan_id):
        plan = self.get(plan_id)
        path = self._state_path(plan_id)
        empty = {"schema": STATE_SCHEMA, "plan_id": plan["id"], "status": "planned",
                 "steps": {}, "created_at": now(), "updated_at": now()}
        if not path.exists():
            return empty
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
            db.execute("BEGIN")
            row = db.execute("SELECT body FROM header WHERE singleton=1").fetchone()
            if row is None:
                return empty
            state = json.loads(row[0])
            state["steps"] = {key: json.loads(body) for key, body in
                              db.execute("SELECT key,body FROM steps ORDER BY key")}
        if state.get("schema") != STATE_SCHEMA or state.get("plan_id") != plan["id"]:
            raise ValueError("Refresh execution state does not match its immutable plan")
        return state

    @staticmethod
    def _open_state(path):
        path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path, timeout=30)
        # Rollback-journal mode gives the native backup one closed, ordinary file.
        # Header + active step commit together; no growing whole-state rewrites.
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("CREATE TABLE IF NOT EXISTS header(singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS steps(key TEXT PRIMARY KEY, body TEXT NOT NULL)")
        db.commit()
        return db

    def list(self):
        return [{"plan": plan, "state": self.state(plan["id"])}
                for plan in self.ws._list(PLAN_KIND)]

    def _validate_plan(self, plan):
        # Reconstruct against native immutable selections; imported/tampered plans
        # cannot inject arbitrary payloads or substitute a different dependency.
        roots = {kind: [] for kind in NATIVE_KINDS}
        for root in plan["roots"]:
            kind, key = root.split("/", 1)
            roots[kind].append(identifier(key))
        payload = self._plan_value(plan["from_collection_id"], plan["to_collection_id"],
                                   mapping=plan["mapping"], roots=roots, title=plan["title"])
        # Match Workspace._save exactly while keeping restore verification read-only.
        rebuilt = {"schema": "upstate." + PLAN_KIND + "/v1", **payload}
        if digest(rebuilt) != plan["id"]:
            raise ValueError("Native selections changed since this refresh plan was prepared")

    def _prepare(self, plan, node, state):
        if node["action"] == "reuse":
            self._native(node["kind"], node["old_id"])
            return node["old_id"]
        payload = deepcopy(node["selection"])
        if node["kind"] == "runs":
            for dep in node["dependencies"]:
                payload[dep["field"]] = state["steps"][dep["key"]]["new_id"]
            return self.ws.prepare_run(payload)["id"]
        payload["source_collection_id"] = plan["to_collection_id"]
        for ref in node["source_references"]:
            if ref["replacement_id"] is None:
                raise ValueError("Provide a replacement for source: " + ref["source_id"])
            self._assign(payload, ref["field"], ref["replacement_id"])
        operation = {"grids": self.ws.prepare_grid, "profiles": self.ws.save_profile,
                     "scenarios": self.ws.save_scenario}[node["kind"]]
        return operation(payload)["id"]

    def _check_checkpoint(self, plan, node, state, step):
        """Re-run idempotent native selection preparation, never trust mutable IDs."""
        expected = self._prepare(plan, node, state)
        if expected != step.get("new_id"):
            raise ValueError("Refresh checkpoint selects a different native result: " + node["key"])
        return expected

    def apply(self, plan_id: str, *, execute_runs=True,
              progress: Callable[[dict], None] | None = None,
              cancelled: Callable[[], bool] | None = None):
        plan = self.get(plan_id)
        path = self._state_path(plan_id)
        with held(path.parent / ".refresh.lock"), closing(self._open_state(path)) as db:
            self._validate_plan(plan)
            unresolved = [n for n in plan["nodes"] if n["action"] == "missing"]
            if unresolved:
                raise ValueError("Refresh requires source mappings: " + "; ".join(
                    n["key"] + ": " + ", ".join(n["reasons"]) for n in unresolved))
            state = self.state(plan_id)
            extra = set(state["steps"]) - {node["key"] for node in plan["nodes"]}
            if extra:
                raise ValueError("Execution state contains steps outside the immutable plan")
            state["status"] = "running"
            state.pop("error", None)

            def save():
                state["updated_at"] = now()
                header = {key: value for key, value in state.items() if key != "steps"}
                active = state.get("active_step")
                with db:
                    db.execute("INSERT INTO header VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body",
                               (canonical(header).decode(),))
                    if active in state["steps"]:
                        db.execute("INSERT INTO steps VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body",
                                   (active, canonical(state["steps"][active]).decode()))
                if progress:
                    # Progress is a compact event; full receiving remains state().
                    progress({**deepcopy(header), "steps": {active: deepcopy(state["steps"][active])}
                              if active in state["steps"] else {}})

            save()
            try:
                for node in plan["nodes"]:
                    if cancelled and cancelled():
                        state["status"] = "cancelled"
                        save()
                        return RefreshResult(plan, state)
                    key = node["key"]
                    step = state["steps"].setdefault(key, {"status": "pending", "attempts": 0})
                    state["active_step"] = key
                    step["attempts"] += 1
                    step["status"] = "preparing"
                    step.pop("error", None)
                    save()
                    new_id = (self._check_checkpoint(plan, node, state, step)
                              if step.get("new_id") else self._prepare(plan, node, state))
                    step.update(new_id=new_id, action=node["action"], status="prepared")
                    save()
                    if node["kind"] == "runs":
                        native = self.ws.inspect_run(new_id)
                        if execute_runs and node["action"] == "derive" and native.get("state") != "complete":
                            step["status"] = "executing"
                            save()
                            self.ws.run(new_id)
                            native = self.ws.inspect_run(new_id)
                        step["native_state"] = native.get("state")
                        step["status"] = ("complete" if native.get("state") == "complete" or node["action"] == "reuse" else "prepared")
                    else:
                        step["status"] = "complete"
                    save()
                state.pop("active_step", None)
                state["status"] = ("complete" if all(v["status"] == "complete"
                                   for v in state["steps"].values()) else "prepared")
                save()
            except BaseException as exc:
                state["status"] = "interrupted" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "failed"
                # Retain the exception type + message, but never traceback locals.
                state["error"] = {"type": type(exc).__name__, "message": str(exc)}
                key = state.get("active_step")
                if key in state["steps"]:
                    state["steps"][key]["status"] = state["status"]
                    state["steps"][key]["error"] = state["error"]
                save()
                raise
            return RefreshResult(plan, state)

    def export(self, plan_id: str, destination: str | Path):
        """Complete editable workspace handover through the original backup engine."""
        self._validate_plan(self.get(plan_id))
        # Delegate original selection/object/application retention to the native writer.
        with held(self._state_path(plan_id).parent / ".refresh.lock"):
            return self.ws.backup(destination, include_intermediates=True)

    def report(self, plan_id: str):
        plan, state = self.get(plan_id), self.state(plan_id)
        rows = []
        for node in plan["nodes"]:
            step = state["steps"].get(node["key"], {})
            rows.append({"kind": node["kind"], "action": node["action"],
                         "old_id": node["old_id"], "new_id": step.get("new_id", ""),
                         "state": step.get("status", "planned"),
                         "native_state": step.get("native_state", "") if node["kind"] == "runs" else "",
                         "reason": "; ".join(node["reasons"])})
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=("kind", "action", "old_id", "new_id", "state", "native_state", "reason"))
        writer.writeheader()
        writer.writerows(rows)
        esc = lambda value: html.escape(str(value), quote=True)
        body = "".join("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in row.values()) + "</tr>" for row in rows)
        sources = "".join("<tr><td>" + esc(r["source_id"] or "—") + "</td><td>" +
                          esc(r["replacement_id"] or "—") + "</td><td>" + esc(r["change"]) +
                          "</td><td>" + esc(r["reason"]) + "</td></tr>" for r in plan["changes"])
        document = ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width, initial-scale=1'>"
            "<title>Source refresh</title><style>body{font:15px system-ui;color:#222;background:#fff;margin:2rem;max-width:1400px}"
            "table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #bbb;padding:.6rem;text-align:left;"
            "overflow-wrap:anywhere}th{background:#eee}p,code{overflow-wrap:anywhere}@media print{body{margin:0}tr{break-inside:avoid}}"
            "</style><h1>" + esc(plan["title"]) + "</h1><p>Status: <strong>" + esc(state["status"]) +
            "</strong></p><p>Plan: " + esc(plan_id) + "</p><p>Previous source edition: " + esc(plan["from_collection_id"]) +
            "<br>Replacement source edition: " + esc(plan["to_collection_id"]) + "</p><p>Reused selections retain their original source "
            "bindings. Derived selections use the replacement edition. Previous outputs remain available. "
            "Refresh status describes source-replacement work; the separate native run state records scientific execution. "
            "An unchanged prepared or failed run stays in its original state.</p>"
            "<h2>Source changes</h2><table><thead><tr><th>Previous source</th><th>Replacement</th><th>Change</th><th>Reason</th></tr>"
            "</thead><tbody>" + sources + "</tbody></table><h2>Native selections</h2><table><thead><tr>"
            "<th>Kind</th><th>Action</th><th>Previous ID</th><th>Result ID</th><th>Refresh step</th><th>Native run state</th><th>Reason</th></tr></thead><tbody>" + body +
            "</tbody></table><p>TokenJunkieLabs · Upper Savannah scientific workspace</p></html>")
        return {"json": {"plan": plan, "state": state}, "csv": stream.getvalue(), "html": document}

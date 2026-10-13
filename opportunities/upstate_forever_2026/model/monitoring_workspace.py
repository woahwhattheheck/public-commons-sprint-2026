"""Monitoring operations in the original scientific Workspace.

Uses native immutable records, source_file, held/atomic_json and native complete
workspace portability. It does not replace the existing workspace or server.
"""
from __future__ import annotations

import csv
import html
import io
import json
import os
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from .monitoring_common import ContractError, atomic_json, canonical_bytes, digest, file_sha256, held, load_json, utc_now
from .monitoring_network import build_network, identifier
from .monitoring_design import solve_design, solve_frontier
from .monitoring_campaign import dollars, integer, money_cents

COLLECTIONS = {"networks": "monitoring_networks", "plans": "monitoring_plans", "frontiers": "monitoring_frontiers",
               "revisions": "monitoring_revisions", "events": "monitoring_events"}


def csv_text(rows: list[dict], fields: list[str]) -> str:
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        values = {}
        for key in fields:
            value = row.get(key, "")
            if value is None: value = ""
            elif isinstance(value, (dict, list)): value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                value = "'" + value  # Spreadsheet formula safety, JSON remains lossless.
            values[key] = value
        writer.writerow(values)
    return out.getvalue()


def _clean_id(value: Any, name: str) -> str:
    value = identifier(value, name)
    if len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ContractError(f"{name} must be a native 64-character SHA256 record ID")
    return value


class MonitoringWorkspace:
    def __init__(self, workspace, *, export_root=None):
        self.workspace = workspace
        self.root = workspace.root
        self.export_root = Path(export_root).resolve() if export_root else None
        # Original immutable writes and lock primitives create their own parents.
        # Catalog/receiving reads leave an unopened or restored Workspace intact.
        self.lock = self.root / "monitoring.lock"

    def get(self, kind: str, record_id: str) -> dict:
        if kind not in COLLECTIONS:
            raise ContractError(f"unknown monitoring collection {kind}")
        return self.workspace._get(COLLECTIONS[kind], record_id)

    def save(self, kind: str, value: dict) -> dict:
        return self.workspace._save(COLLECTIONS[kind], value)

    def list(self, kind: str, *, limit: int = 50, cursor: str | None = None, snapshot: str | None = None) -> dict:
        if kind not in COLLECTIONS:
            raise ContractError(f"unknown monitoring collection {kind}")
        integer(limit, "limit", 1)
        if limit > 500: raise ContractError("page limit cannot exceed 500; follow next_cursor for every record")
        paths = sorted((self.root / COLLECTIONS[kind]).glob("*.json"))
        identities = [p.stem for p in paths]
        current_snapshot = digest(identities)
        if snapshot and snapshot != current_snapshot:
            raise ContractError("collection changed during pagination; restart from the first page")
        if cursor is not None:
            _clean_id(cursor, "cursor")
            if cursor not in identities: raise ContractError("pagination cursor no longer exists")
            offset = identities.index(cursor) + 1
        else:
            offset = 0
        page = identities[offset:offset + limit]
        records = []
        for record_id in page:
            record = self.get(kind, record_id)
            summary = {key: record[key] for key in ("id", "title", "schema", "created_at", "status", "network_id", "summary",
                                                    "selected_ids", "coverage", "cost", "campaign_id", "revision", "parent_id") if key in record}
            records.append(summary)
        return {"records": records, "total": len(identities), "snapshot": current_snapshot,
                "next_cursor": page[-1] if offset + len(page) < len(identities) else None}

    def _source(self, source_id: str, collection_id: str | None = None, layer: str | None = None) -> tuple[dict, dict]:
        from .monitoring_sources import read_source
        return read_source(self.workspace, source_id, collection_id=collection_id, layer=layer)

    def import_network(self, *, domain_source_id: str, station_source_id: str | None = None,
                       domain_collection_id: str | None = None, station_collection_id: str | None = None,
                       domain_layer: str | None = None, station_layer: str | None = None, **options) -> dict:
        domain, domain_binding = self._source(domain_source_id, domain_collection_id, domain_layer)
        if station_source_id:
            stations, station_binding = self._source(station_source_id, station_collection_id or domain_collection_id, station_layer)
        else:
            stations, station_binding = None, None
        allowed = {"id_field", "downstream_field", "stratum_field", "priority_field", "station_id_field",
                   "station_huc_field", "station_outlet_field", "station_assignments", "outlet_values", "title"}
        unknown = set(options) - allowed
        if unknown: raise ContractError(f"unknown network options: {sorted(unknown)}")
        value = build_network(domain, stations, source_bindings={"domain": domain_binding, "stations": station_binding}, **options)
        value["created_at"] = utc_now()
        return self.save("networks", value)

    def verify_sources(self, network: dict) -> None:
        from .monitoring_sources import verify_binding
        for binding in network["source_bindings"].values():
            if binding: verify_binding(self.workspace, binding)

    def design(self, *, network_id: str, configuration: dict, title: str = "Monitoring design") -> dict:
        network = self.get("networks", network_id)
        self.verify_sources(network)
        result = solve_design(network, configuration)
        result["title"] = str(title)
        return self.save("plans", result)

    def _frontier_identity(self, network_id: str, configuration: dict, budgets: list[str], title: str) -> tuple[str, list[int]]:
        _clean_id(network_id, "network_id")
        if not isinstance(budgets, list) or not budgets:
            raise ContractError("frontier budgets must be a nonempty array")
        values = sorted(money_cents(value, "frontier budget") for value in budgets)
        if len(set(values)) != len(values): raise ContractError("frontier budgets must be distinct")
        return digest({"network_id": network_id, "configuration": configuration, "budgets_cents": values, "title": title}), values

    def frontier_progress(self, *, network_id: str, configuration: dict, budgets: list[str], title: str = "Budget comparison") -> dict:
        job_id, values = self._frontier_identity(network_id, configuration, budgets, title)
        path = self.root / "monitoring_frontier_jobs" / f"{job_id}.json"
        head = load_json(path) if path.exists() else {"completed": {}}
        return {"job_id": job_id, "budgets_total": len(values), "budgets_completed": len(head["completed"]),
                "plan_ids": head["completed"], "resume": "repeat the exact frontier request to reuse completed budgets"}

    def frontier(self, *, network_id: str, configuration: dict, budgets: list[str], title: str = "Budget comparison") -> dict:
        network = self.get("networks", network_id)
        self.verify_sources(network)
        job_id, values = self._frontier_identity(network_id, configuration, budgets, title)
        path = self.root / "monitoring_frontier_jobs" / f"{job_id}.json"
        # A per-frontier lock does not stop unrelated field recording or designs.
        with held(path.with_suffix(".lock")):
            resuming = path.exists()
            head = load_json(path) if resuming else {"job_id": job_id, "created_at": utc_now(), "completed": {}}
            atomic_json(path, head)
            recovered = {}
            if resuming:
                # Repair death between immutable-plan publication and head update.
                for record_path in sorted((self.root / COLLECTIONS["plans"]).glob("*.json")):
                    candidate = load_json(record_path)
                    if candidate.get("frontier_job_id") == job_id:
                        candidate = self.get("plans", record_path.stem)
                        recovered[str(candidate["frontier_budget_cents"])] = candidate["id"]
            saved = []
            for value in values:
                key = str(value)
                record_id = head["completed"].get(key) or recovered.get(key)
                if record_id:
                    plan = self.get("plans", record_id)
                else:
                    plan = self.save("plans", {**solve_design(network, {**configuration, "budget": dollars(value)}),
                        "title": f"{title}: {dollars(value)}", "frontier_job_id": job_id,
                        "frontier_budget_cents": value, "created_at": head["created_at"]})
                head["completed"][key] = plan["id"]
                atomic_json(path, head)
                saved.append(plan)
            result = {"schema": "eco.monitoring.frontier/1", "title": title, "network_id": network_id,
                "job_id": job_id, "created_at": head["created_at"], "budgets_completed": len(saved),
                "plan_ids": [value["id"] for value in saved],
                "rows": [{"budget": value["configuration"]["budget"], "status": value["status"],
                    "selected_sites": len(value["selected_ids"]), "covered_weight": value.get("coverage", {}).get("covered_weight"),
                    "total_cost": value.get("cost", {}).get("total_display"), "selected_ids": value["selected_ids"]} for value in saved]}
            return self.save("frontiers", result)

    def _head_path(self, campaign_id: str) -> Path:
        return self.root / "monitoring_heads" / f"{_clean_id(campaign_id, 'campaign_id')}.json"

    def _head(self, campaign_id: str) -> dict:
        path = self._head_path(campaign_id)
        if not path.is_file(): raise ContractError("monitoring campaign does not exist")
        head = load_json(path)
        revision = self.get("revisions", head["revision_id"])
        if revision["campaign_id"] != campaign_id: raise ContractError("campaign identity mismatch")
        return head

    def _commit(self, head: dict, previous: dict | None, *, change: dict, operation_id: str, fingerprint: str) -> dict:
        record = self.save("revisions", {"schema": "eco.monitoring.campaign/1", **change,
                                        "campaign_id": head["campaign_id"],
                                        "revision": previous["revision"] + 1 if previous else 1,
                                        "parent_id": previous["id"] if previous else None,
                                        "operation_id": operation_id})
        updated = {**head, "revision_id": record["id"],
                   "operations": {**head.get("operations", {}), operation_id: {"fingerprint": fingerprint, "revision_id": record["id"]}}}
        atomic_json(self._head_path(head["campaign_id"]), updated)
        return record

    def _replay(self, head: dict, operation_id: str, fingerprint: str) -> dict | None:
        prior = head.get("operations", {}).get(operation_id)
        if prior:
            if prior["fingerprint"] != fingerprint: raise ContractError("operation_id was already used for a different operation")
            return self.get("revisions", prior["revision_id"])
        return None

    def create_campaign(self, *, plan_id: str, title: str, operation_id: str) -> dict:
        operation_id = identifier(operation_id, "operation_id")
        plan = self.get("plans", plan_id)
        if plan["status"] not in {"optimal", "feasible"}: raise ContractError("campaign requires a feasible saved plan")
        payload = {"command": "create_campaign", "operation_id": operation_id, "plan_id": plan_id, "title": title}
        # One logical creation per client operation, even after a lost response.
        campaign_id = digest({"monitoring_campaign_creation": operation_id})
        fingerprint = digest(payload)
        with held(self.lock):
            if self._head_path(campaign_id).exists():
                head = self._head(campaign_id)
                replay = self._replay(head, operation_id, fingerprint)
                if replay: return replay
                raise ContractError("campaign creation operation is already present")
            head = {"campaign_id": campaign_id, "operations": {}}
            return self._commit(head, None, change={"title": str(title), "plan_id": plan_id,
                                "network_id": plan["network_id"], "site_bindings": {}, "event_ids": [],
                                "note": "Created from saved monitoring design."}, operation_id=operation_id, fingerprint=fingerprint)

    def campaign(self, campaign_id: str) -> dict:
        head = self._head(campaign_id)
        revision = self.get("revisions", head["revision_id"])
        plan = self.get("plans", revision["plan_id"])
        network = self.get("networks", revision["network_id"])
        events = [self.get("events", key) for key in revision["event_ids"]]
        recent = {}
        for event in events:
            if event["plan_id"] == plan["id"] and event["status"] != "note": recent[event["visit_key"]] = event
        calendar = []
        for visit in plan["calendar"]["visits"]:
            event = recent.get(visit["visit_key"])
            planned_station = revision["site_bindings"].get(visit["site_id"])
            calendar.append({**visit, "planned_station_id": planned_station,
                             "station_id": event.get("station_id") if event else planned_station,
                             "status": event["status"] if event else "planned", "latest_event_id": event["id"] if event else None})
        return {"revision": revision, "plan": plan, "network_summary": network["summary"],
                "calendar": calendar, "events": events}

    def campaigns(self) -> list[dict]:
        result = []
        for path in sorted((self.root / "monitoring_heads").glob("*.json")):
            head = self._head(path.stem)
            revision = self.get("revisions", head["revision_id"])
            result.append({key: revision[key] for key in ("campaign_id", "id", "title", "revision", "plan_id", "network_id")})
        return result

    def revise_campaign(self, *, campaign_id: str, expected_revision_id: str, operation_id: str,
                        plan_id: str | None = None, title: str | None = None, note: str = "", site_bindings: dict | None = None) -> dict:
        operation_id = identifier(operation_id, "operation_id")
        payload = {"command": "revise_campaign", "campaign_id": campaign_id, "expected_revision_id": expected_revision_id,
                   "operation_id": operation_id, "plan_id": plan_id, "title": title, "note": note, "site_bindings": site_bindings}
        fingerprint = digest(payload)
        with held(self.lock):
            head = self._head(campaign_id)
            replay = self._replay(head, operation_id, fingerprint)
            if replay: return replay
            if head["revision_id"] != expected_revision_id: raise ContractError("stale campaign revision; reload before editing")
            previous = self.get("revisions", head["revision_id"])
            plan = self.get("plans", plan_id or previous["plan_id"])
            if plan["status"] not in {"optimal", "feasible"}: raise ContractError("campaign requires a feasible saved plan")
            network = self.get("networks", plan["network_id"])
            self.verify_sources(network)
            selected = set(plan["selected_ids"])
            bindings = dict(site_bindings if site_bindings is not None else previous["site_bindings"])
            stations = {s["id"]: s for s in network["stations"]}
            if set(bindings) - selected: raise ContractError("bindings include unselected catchments; explicitly reconcile them with the new plan")
            for huc, station_id in bindings.items():
                if station_id not in stations or stations[station_id]["huc_id"] != huc:
                    raise ContractError(f"binding {huc}: choose an actual source station assigned to this catchment")
                if plan["coverage_mode"] == "outlet_context" and not stations[station_id]["outlet_verified"]:
                    raise ContractError(f"binding {huc}: outlet-context design requires source outlet verification")
            return self._commit(head, previous, change={"title": title if title is not None else previous["title"],
                "plan_id": plan["id"], "network_id": plan["network_id"], "site_bindings": bindings,
                "event_ids": previous["event_ids"], "note": str(note)}, operation_id=operation_id, fingerprint=fingerprint)

    def field_event(self, *, campaign_id: str, expected_revision_id: str, operation_id: str,
                    visit_key: str, status: str, occurred_at: str, sample_id: str | None = None,
                    note: str = "", values: dict | None = None) -> dict:
        if status not in {"collected", "missed", "cancelled", "note"}:
            raise ContractError("field event status must be collected, missed, cancelled or note")
        operation_id = identifier(operation_id, "operation_id")
        try:
            dt = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
            if dt.tzinfo is None: raise ValueError()
        except (ValueError, TypeError, AttributeError) as exc:
            raise ContractError("occurred_at requires an ISO timestamp including timezone") from exc
        if values is not None and not isinstance(values, dict): raise ContractError("values must be a JSON object")
        if status == "collected": sample_id = identifier(sample_id, "sample_id")
        payload = {"command": "field_event", "campaign_id": campaign_id, "expected_revision_id": expected_revision_id,
                   "operation_id": operation_id, "visit_key": visit_key, "status": status, "occurred_at": occurred_at,
                   "sample_id": sample_id, "note": str(note), "values": values or {}}
        fingerprint = digest(payload)
        with held(self.lock):
            head = self._head(campaign_id)
            replay = self._replay(head, operation_id, fingerprint)
            if replay: return replay
            if head["revision_id"] != expected_revision_id: raise ContractError("stale campaign revision; reload before recording")
            previous = self.get("revisions", head["revision_id"])
            plan = self.get("plans", previous["plan_id"])
            visits = {v["visit_key"]: v for v in plan["calendar"]["visits"]}
            if visit_key not in visits: raise ContractError("visit_key is not in this campaign's current saved plan")
            site_id = visits[visit_key]["site_id"]
            station_id = previous["site_bindings"].get(site_id)
            if status == "collected" and not station_id:
                raise ContractError("bind an actual retained source station before recording a collected sample")
            if sample_id:
                for event_id in previous["event_ids"]:
                    event = self.get("events", event_id)
                    if event.get("sample_id") == sample_id and (event["visit_key"], event["plan_id"]) != (visit_key, plan["id"]):
                        raise ContractError("sample_id is already attached to a different planned visit")
            event = self.save("events", {**payload, "schema": "eco.monitoring.field-event/1", "plan_id": plan["id"],
                                        "network_id": plan["network_id"], "site_id": site_id, "station_id": station_id,
                                        "recorded_at": utc_now(), "source_bindings": plan["source_bindings"]})
            return self._commit(head, previous, change={key: previous[key] for key in ("title", "plan_id", "network_id", "site_bindings")} |
                 {"event_ids": previous["event_ids"] + [event["id"]], "note": f"{status}: {visit_key}"},
                 operation_id=operation_id, fingerprint=fingerprint)

    def history(self, campaign_id: str) -> list[dict]:
        record = self.get("revisions", self._head(campaign_id)["revision_id"])
        records, seen = [], set()
        while record:
            if record["id"] in seen: raise ContractError("campaign revision cycle")
            seen.add(record["id"]); records.append(record)
            record = self.get("revisions", record["parent_id"]) if record["parent_id"] else None
        return list(reversed(records))

    def export(self, *, campaign_id: str | None = None, plan_id: str | None = None,
               format: str = "bundle", expected_revision_id: str | None = None,
               context_id: str | None = None) -> dict:
        # Keep the selected campaign, calendar, event history and archive together.
        with held(self.lock, blocking=False):
            return self._export(campaign_id=campaign_id, plan_id=plan_id, format=format,
                                expected_revision_id=expected_revision_id, context_id=context_id)

    def _export(self, *, campaign_id=None, plan_id=None, format="bundle",
                expected_revision_id=None, context_id=None):
        if bool(campaign_id) == bool(plan_id): raise ContractError("choose exactly one campaign_id or plan_id")
        if format not in {"bundle", "workspace", "html"}: raise ContractError("export format must be bundle, workspace or html")
        campaign = self.campaign(campaign_id) if campaign_id else None
        if expected_revision_id is not None:
            _clean_id(expected_revision_id, "expected_revision_id")
            if campaign is None or campaign["revision"]["id"] != expected_revision_id:
                raise ContractError("The selected campaign revision changed; reopen it before exporting")
        plan = campaign["plan"] if campaign else self.get("plans", plan_id)
        if plan["status"] not in {"optimal", "feasible"}: raise ContractError("export requires a feasible design")
        network = self.get("networks", plan["network_id"])
        self.verify_sources(network)
        observed_context = None
        if context_id:
            from . import monitoring_observed_context as observed
            observed_context = observed.inspect(self.workspace, context_id)
            if observed_context.get("plan_id") != plan["id"] or observed_context["network_id"] != network["id"]:
                raise ContractError("Observed context must match this exact saved plan and network")
            if campaign and observed_context.get("campaign_revision_id") != campaign["revision"]["id"]:
                raise ContractError("Observed context must match the exported campaign revision")
        # Native backups must be outside the workspace so old archives never recurse.
        base = self.export_root or (self.root.parent / (self.root.name + "-monitoring-exports"))
        if format == "workspace" and base.resolve().is_relative_to(self.root.resolve()):
            raise ContractError("Native complete-workspace exports need an output directory outside the workspace")
        folder = base / f"monitoring-export-{uuid.uuid4().hex}"
        folder.mkdir(parents=True)
        if format == "workspace":
            destination = folder / "monitoring-editable-workspace.zip"
            with held(self.root / ".operator-session.lock", blocking=False):
                if callable(getattr(self.workspace, "backup", None)):
                    manifest = self.workspace.backup(destination, include_intermediates=True)
                else:
                    # The maintained portable API accepts the original workspace.
                    from .portable import backup
                    manifest = backup(self.workspace, destination, include_intermediates=True)
            return self._download(destination, {"native_manifest": manifest, "format": "original-workspace"})
        visits = campaign["calendar"] if campaign else plan["calendar"]["visits"]
        events = campaign["events"] if campaign else []
        title = campaign["revision"]["title"] if campaign else plan["title"]
        from . import utility_monitoring_report
        utility_contexts = utility_monitoring_report.contexts(self.workspace, plan, network, visits)
        report = utility_monitoring_report.attach(
            report_html(title, plan, network, visits, events), utility_contexts, links=format == "bundle")
        if observed_context:
            context_html = observed.report_html(observed_context).split("</style>", 1)[1].rsplit("</html>", 1)[0]
            closing = "</body>" if "</body>" in report else "</html>"
            report = report.replace(closing, "<section id='observed-context'>" + context_html + "</section>" + closing, 1)
        if format == "html":
            # A selected report needs no GeoJSON, history export, companion
            # materialization or observational CSV/archive construction.
            destination = folder / "monitoring-report.html"
            destination.write_bytes(report.encode("utf-8"))
            return self._download(destination, {"format": format, "plan_id": plan["id"], "campaign_id": campaign_id,
                                                "files": 1, "visits": len(visits), "events": len(events)})
        from .monitoring_packet import add_member, bytes_member, retain_packet
        from .monitoring_sources import source_export_members
        selected = set(plan["selected_ids"])
        covered = set(plan["covered_ids"])
        geojson = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": key,
            "geometry": node["geometry"], "properties": {"catchment_id": key, "downstream_id": node["downstream_id"],
            "stratum": node["stratum"], "selected": key in selected, "covered": key in covered,
            "weight": node["weight"], "area_km2": node["area_km2"], "geometry_role": "source-catchment-search-area",
            "source_properties": node["source_properties"]}} for key, node in sorted(network["nodes"].items())]}
        station_features = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": s["id"], "geometry": s["geometry"],
            "properties": {k: v for k, v in s.items() if k != "geometry"}} for s in network["stations"]]}
        files = {"network.json": canonical_bytes(network), "plan.json": canonical_bytes(plan),
                 "catchments.geojson": canonical_bytes(geojson), "source-stations.geojson": canonical_bytes(station_features),
                 "calendar.csv": csv_text(visits, ["visit_key", "site_id", "station_id", "planned_station_id", "round", "date", "start_local", "finish_local", "crew", "status"]).encode(),
                 "selected-sites.csv": csv_text([{"catchment_id": row["id"], "stratum": row["stratum"],
                      "total_cost": dollars(row["cost"]["total_cents"]), "rounds": row["cost"]["rounds"],
                      "coverage_ids": row["coverage_ids"], "marginal_weight": row["marginal_weight"], "geometry_role": row["geometry_role"]}
                      for row in plan["selected"]], ["catchment_id", "stratum", "total_cost", "rounds", "coverage_ids", "marginal_weight", "geometry_role"]).encode(),
                 "events.json": canonical_bytes(events), "events.csv": csv_text(events, ["id", "plan_id", "network_id", "visit_key", "site_id", "station_id", "status", "sample_id", "occurred_at", "recorded_at", "note", "values"]).encode(),
                 "source-bindings.json": canonical_bytes(network["source_bindings"])}
        if campaign:
            files["campaign.json"] = canonical_bytes(campaign["revision"])
            files["campaign-history.json"] = canonical_bytes(self.history(campaign_id))
        # Only generated metadata is held in memory. Native bodies and their
        # complete original companions remain checked, streamable descriptors.
        files = {name: bytes_member(body) for name, body in files.items()}
        for label, binding in network["source_bindings"].items():
            if binding:
                for name, member in source_export_members(self.workspace, label, binding):
                    add_member(files, name, member)
        add_member(files, "report.html", bytes_member(report.encode("utf-8")))
        for name, member in utility_monitoring_report.export_members(self.workspace, utility_contexts):
            add_member(files, name, member)
        if observed_context:
            for name, member in observed._export_members(self.workspace, observed_context):
                add_member(files, name, member)
        readme = ("Monitoring decision and field package\n\n"
            "All source catchment geometry, source station geometry, planning costs, visits and field history are included.\n"
            "This report bundle is for review and exchange. For independently editable receiving, export the original\n"
            "complete workspace with format=workspace, then use the original model.portable.restore workflow.\n"
            "Calendar times are local wall times. Travel allowance is explicit, not route optimization.\n"
            "GeoJSON catchment polygons are search areas, not surveyed field station locations.\n").encode()
        add_member(files, "README.txt", bytes_member(readme))
        add_member(files, "manifest.json", bytes_member(canonical_bytes({
            "schema": "eco.monitoring.export/1", "files": [
                {"path": name, "bytes": member["bytes"], "sha256": member["sha256"]}
                for name, member in sorted(files.items())]})))
        destination = folder / "monitoring-field-package.zip"
        retain_packet(destination, files, metadata="export")
        return self._download(destination, {"format": format, "plan_id": plan["id"], "campaign_id": campaign_id,
                                            "files": len(files), "visits": len(visits), "events": len(events)})

    def _download(self, path: Path, metadata: dict) -> dict:
        from urllib.parse import quote
        result = {**metadata, "filename": path.name, "bytes": path.stat().st_size, "sha256": file_sha256(path)}
        if self.export_root or not path.is_relative_to(self.root):
            # The native operator exchanges this private path for its existing
            # authenticated file ticket before returning a public task result.
            result["path"] = str(path.resolve())
        else:
            relative = path.relative_to(self.root).as_posix()
            result.update(path=relative, download_url="/api/download?path=" + quote(relative, safe=""))
        return result


def report_html(title: str, plan: dict, network: dict, visits: list[dict], events: list[dict]) -> str:
    esc = lambda value: html.escape(str(value))
    def table(headers, rows):
        return "<table><thead><tr>" + "".join(f"<th>{esc(h)}</th>" for h in headers) + "</tr></thead><tbody>" + "".join(
            "<tr>" + "".join(f"<td>{esc(v)}</td>" for v in row) + "</tr>" for row in rows) + "</tbody></table>"
    fraction = plan["coverage"]["fraction"]
    fraction_text = f"{fraction:.1%}" if fraction is not None else "No positive target weights"
    sources = table(["Source", "Retained ID", "SHA256"], [(k, v["source_id"], v["object_sha256"]) for k, v in network["source_bindings"].items() if v])
    selected = table(["Catchment search area", "Stratum", "Campaign cost", "Rounds", "Covered catchments"], [
        (row["id"], row["stratum"], dollars(row["cost"]["total_cents"]), row["cost"]["rounds"], ", ".join(row["coverage_ids"])) for row in plan["selected"]])
    calendar = table(["Visit", "Source station", "Date", "Local time", "Crew", "Status"], [
        (v["visit_key"], v.get("station_id") or "Unbound search area", v["date"], f"{v['start_local']}–{v['finish_local']}", v["crew"], v["status"]) for v in visits])
    event_table = table(["Source station", "Sample", "Status", "Occurred", "Notes"], [
        (e.get("station_id") or "", e.get("sample_id") or "", e["status"], e["occurred_at"], e["note"]) for e in events])
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)} — Monitoring plan</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#eee;color:#161616;font:15px/1.5 system-ui,sans-serif}}main{{max-width:1200px;margin:24px auto;padding:32px;background:white}}h1{{font-size:28px;margin:0}}h2{{font-size:20px;border-top:2px solid #333;padding-top:18px;margin-top:32px}}p{{max-width:90ch}}.meta{{color:#555}}.summary{{display:flex;gap:30px;flex-wrap:wrap;padding:18px 0;border-bottom:1px solid #bbb}}.summary strong{{display:block;font-size:22px}}table{{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;table-layout:auto}}th,td{{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ccc;overflow-wrap:anywhere}}th{{background:#eee}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px;font-size:12px}}@media print{{body{{background:white}}main{{margin:0;padding:0}}thead{{display:table-header-group}}tr{{break-inside:avoid}}}}</style></head><body><main>
<p class="meta">ECOSYSTEM SCIENCES · MONITORING DESIGN & FIELD OPERATIONS</p><h1>{esc(title)}</h1>
<p class="meta">Saved plan {esc(plan['id'])}</p><div class="summary"><div><strong>{len(plan['selected_ids'])}</strong>Selected search areas</div><div><strong>{esc(plan['cost']['currency'])} {esc(plan['cost']['total_display'])}</strong>Complete campaign planning cost</div><div><strong>{fraction_text}</strong>Weighted planning coverage</div><div><strong>{len(visits)}</strong>Scheduled visits</div></div>
<p>{esc(plan['coverage_meaning'])}. Target weights: {esc(plan['weight_basis'])}. Existing station costs: {esc(plan['cost']['existing_station_costs'])}.</p>
<h2>Design decisions</h2>{selected}<h2>Complete field calendar</h2><p>{esc(plan['calendar']['scheduling_basis'])}. Source station bindings identify actual retained points; other entries remain catchment search areas.</p>{calendar}
<h2>Field event history</h2>{event_table}<h2>Retained sources</h2>{sources}<h2>Complete configuration and solver outcome</h2>
<pre>{esc(json.dumps({'configuration':plan['configuration'],'solver':plan['solver'],'coverage':plan['coverage'],'cost':plan['cost']},indent=2,ensure_ascii=False))}</pre></main></body></html>'''

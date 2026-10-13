"""Discover the original operator API without adding a writer or native engine."""
from __future__ import annotations

from copy import deepcopy
import re

CORE_READS = {
    "/api/whoami": "Authenticated person and available original workspaces",
    "/api/state": "Retained workspace, original sources, runs and task catalogue; compact=1 recommended",
    "/api/extensions": "Actual installed extension routes, actions and registration issues",
    "/api/runtime": "Installed scientific package versions; presence is not a completed native-run receipt",
    "/api/item": "Original retained item and file tickets; choose kind and id",
    "/api/source-info": "Original source metadata, sample and download; choose collection and source",
    "/api/task": "Original task status/result/downloads; choose id",
    "/api/native-job": "Original native process progress and logs; choose id and retain run/execution binding",
    "/api/run-log": "Retained native log; choose id and byte offset",
    "/api/file/{ticket_id}": "Original authenticated retained file bytes and range transport",
}
CORE_POSTS = {
    "/api/actions": "Submit or reconcile an exact frozen original operation; returns 202 and retained task",
    "/api/upload": "Stream the original file bytes; X-Workspace and URL-encoded X-Upload-Filename required",
    "/api/task/resume": "Explicitly resume the SAME retained interrupted/failed/cancelled task by id",
    "/api/task/cancel": "Request the original task cancellation by id; inspect returned/native state",
    "/api/source-preview": "Original registered/uploaded source preview",
    "/api/operator-session": "Save original selection/journey with its expected revision",
    "/api/session": "Exchange the existing bearer capability for its original browser file session",
    "/api/logout": "End the original browser file session",
}
COURSE = [
    {"step": "Open original files", "read": "/api/client-source/catalog", "write": "client-source.inspect",
     "meaning": "Upload unchanged files, select reading options and inspect original sheets, fields, layers or bands."},
    {"step": "Review scientific meaning", "read": "/api/client-source/result", "write": "client-source.commit",
     "meaning": "Explicitly confirm original labels, identifiers, roles, units, period and sourced conversions; no silent normalization."},
    {"step": "Prepare scientific inputs", "write": "grid.prepare",
     "meaning": "Use the retained collection and selected boundaries, CRS, resolution and model roles; native GIS required."},
    {"step": "Prepare and run", "write": "run.prepare / run.start",
     "meaning": "Select saved grid, scientist profile and scenario. Original native runtime and serial queue execute the retained run."},
    {"step": "Follow actual work", "read": "/api/task / /api/native-job / /api/item",
     "meaning": "202 means accepted, not completed. Inspect task and original run; never invent a new operation on timeout."},
    {"step": "Read results", "read": "/api/item / /api/deliveries/report / /api/source-reports/scientific-catalog",
     "meaning": "Use original readable reports, figures, maps and CSV companions; inspect units, coverage and simulation/observation basis."},
    {"step": "Transfer and reopen", "read": "/api/study-transfer/catalog / /api/study-transfer/preview",
     "write": "study.export / workspace.backup / workspace.restore",
     "meaning": "Select saved studies or full workspace, download original checksum-bound archive and restore with original identity."},
]


class WorkbenchAPI:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def catalog(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        installed = self.operator.extensions.manifest()
        actions = set(self.operator.extensions.accepted_actions)
        # Read the loaded maintained writer's own globals; do not copy its changing action list.
        actions.update(self.operator.submit.__func__.__globals__.get("ACTIONS", ()))
        reads = [{"method": "GET", "path": path, "summary": summary} for path, summary in CORE_READS.items()]
        reads.extend({"method": "POST", "path": path, "summary": summary} for path, summary in CORE_POSTS.items())
        globals_ = self.operator.submit.__func__.__globals__
        for prefix, constant in (("parameter-studies", "PARAMETER_STUDY_READS"),
                                 ("experiments", "EXPERIMENT_READS"),
                                 ("programmes", "PROGRAMME_READS"),
                                 ("reviews", "CUSTOMER_REVIEW_READS"),
                                 ("rehearsals", "REHEARSAL_READS")):
            reads.extend({"method": "GET", "path": "/api/" + prefix + "/" + name,
                          "summary": "Original " + prefix + " retained view"}
                         for name in sorted(globals_.get(constant, ())))
        reads.append({"method": "GET", "path": "/api/spatial/catalog", "summary": "Original spatial catalogue"})
        reads.extend({"method": "POST", "path": "/api/spatial/" + name,
                      "summary": "Original spatial read"} for name in ("describe", "frame", "overlay", "point"))
        reads.append({"method": "GET", "path": "/api/deliveries/report", "summary": "Readable retained delivery report"})
        reads.extend({"method": "POST", "path": path, "summary": "Preview original scientific selection"} for path in
            ("/api/parameter-studies/preview", "/api/experiments/preview", "/api/programmes/preview",
             "/api/programmes/experiment-preview", "/api/programmes/interaction-preview", "/api/programmes/delivery-preview"))
        for entry in installed["extensions"]:
            reads.extend({**route, "extension": entry["id"]} for route in entry["reads"])
            reads.extend({**route, "extension": entry["id"]} for route in entry.get("file_routes", []))
        return {"schema": "upstate.workbench-api/v1", "version": "1.0.0",
                "workspace_key": workspace_key, "project_id": ws.project["id"],
                "authentication": "Existing authorized Bearer for the selected origin; hosted transport uses its separate recipient credential. Never publish private native startup JSON.",
                "public_origin": getattr(self.operator, "public_origin", None),
                "operation_contract": {"endpoint": "/api/actions", "fields": ["workspace", "action", "payload", "operation_id"],
                    "operation_id": "16-100 ASCII letters, digits, underscore or hyphen; preserve exact value and payload on recovery",
                    "accepted_status": 202, "completion": "GET /api/task?id=... state=complete; inspect original result and files",
                    "conflict": "409 OPERATION_REUSED when same identity has different selection",
                    "recovery": "Repost the exact frozen request to reconcile acceptance; resume retained failed/interrupted task explicitly."},
                "actions": sorted(actions), "routes": sorted(reads, key=lambda r: (r["path"], r["method"])),
                "workflow": deepcopy(COURSE),
                "extensions": [{"id": e["id"], "version": e["version"]} for e in installed["extensions"]],
                "registration_issues": installed["issues"],
                "guide": "operator/WORKBENCH_API.md", "client": "operator/workbench_client.py",
                "scientific_interpretation": "Scientist-controlled settings, methods and applicability. Retain exact source binding and units; unavailable measurements stay unavailable."}

    def openapi(self, workspace_key):
        catalog = self.catalog(workspace_key)
        paths = {}
        for route in catalog["routes"]:
            operation = {"summary": route.get("summary", "Installed " + route.get("extension", "operator") + " route"),
                         "responses": {"200": {"description": "Original retained response"},
                                       "403": {"description": "Original person/workspace authorization required"},
                                       "422": {"description": "Original selection validation error"}}}
            if route["method"] == "GET":
                operation["parameters"] = [{"name": "workspace", "in": "query", "required": False,
                    "schema": {"type": "string"}, "description": "Existing workspace key; defaults to the selected original workspace."}]
                for parameter in re.findall(r"\{([^}]+)\}", route["path"]):
                    operation["parameters"].append({"name": parameter, "in": "path", "required": True, "schema": {"type": "string"}})
            elif route["path"] != "/api/upload":
                operation["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"type": "object"}}}}
            paths.setdefault(route["path"], {})[route["method"].lower()] = operation
        paths["/api/actions"]["post"]["requestBody"]["content"]["application/json"]["schema"] = {"$ref": "#/components/schemas/Operation"}
        paths["/api/actions"]["post"]["responses"]["202"] = {"description": "Accepted original task; not completed calculation"}
        paths["/api/actions"]["post"]["responses"].pop("200", None)
        paths["/api/actions"]["post"]["responses"]["409"] = {"description": "Frozen operation conflicts or operator is draining"}
        paths["/api/upload"]["post"]["parameters"] = [
            {"name": "X-Workspace", "in": "header", "required": True, "schema": {"type": "string"}},
            {"name": "X-Upload-Filename", "in": "header", "required": True, "schema": {"type": "string"}, "description": "URL-encoded ordinary original filename"}]
        paths["/api/upload"]["post"]["requestBody"] = {"required": True, "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}
        paths["/api/upload"]["post"]["responses"]["201"] = {"description": "Complete original retained upload identity"}
        paths["/api/upload"]["post"]["responses"].pop("200", None)
        return {"openapi": "3.1.0", "info": {"title": "TokenJunkieLabs scientific workbench API", "version": catalog["version"],
                    "description": "The maintained operator API. Installed extension payloads remain governed by their original scientific writers; this discovery document adds no execution engine."},
                "servers": [{"url": getattr(self.operator, "public_origin", None) or self.operator.origin}], "security": [{"bearerAuth": []}], "paths": paths,
                "components": {"securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}},
                    "schemas": {"Operation": {"type": "object", "additionalProperties": False,
                        "required": ["workspace", "action", "payload", "operation_id"], "properties": {
                            "workspace": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                            "action": {"type": "string", "enum": catalog["actions"]},
                            "payload": {"type": "object", "description": "Complete original action-specific selection; source writer validates it."},
                            "operation_id": {"type": "string", "pattern": "^[A-Za-z0-9_-]{16,100}$"}}}}},
                "x-workbench-workflow": catalog["workflow"], "x-installed-extensions": catalog["extensions"]}

    def read(self, workspace_key, operation, payload):
        if operation == "catalog":
            return self.catalog(workspace_key)
        if operation == "openapi":
            return self.openapi(workspace_key)
        raise self.Fault("API_DISCOVERY_ROUTE", "Choose the maintained API catalogue or OpenAPI document.", 404)

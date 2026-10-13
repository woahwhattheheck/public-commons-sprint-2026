"""Water and Habitat Context bindings for the existing operator.

Authored by TokenJunkieLabs. The original operator owns task execution,
workspace access and verified file delivery. Scientific work stays in
model.water_context and runs only through the explicit build action.
"""
from __future__ import annotations

from model import water_context
from model.common import identifier, read_json, relative_file, verify_file

ACTION = "water-context.build"
ITEM_KIND = "water-context"
STATE_SCHEMA = "upstate.water-context-state/v1"

FILE_LABELS = {
    "archive": "Complete context export (ZIP)",
    "geojson": "Complete context geometry (GeoJSON)",
    "summary_csv": "Context inventory summary (CSV)",
    "boundary_summaries_csv": "HUC and utility inventory summaries (CSV)",
    "features_csv": "Features, grid footprints and measurements (CSV)",
    "relationships_csv": "Feature and boundary relationships (CSV)",
    "selection": "Saved source and boundary selection (JSON)",
    "sources": "Original source editions and lineage (JSON)",
    "summary_json": "Context inventory summary (JSON)",
    "boundary_summaries_json": "HUC and utility inventory summaries (JSON)",
    "geometry_corrections": "Recorded geometry corrections (JSON)",
    "preview": "Prepared map preview (GeoJSON envelope)",
    "readme": "Methods and export guide",
    "portable_record": "Portable analysis record (JSON)",
}
FILE_ORDER = tuple(FILE_LABELS)


class WaterContextService:
    """Explicit provider for the application's extension registry."""

    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault

    def _fail(self, code, message, status=422):
        raise self.fault(code, message, status)

    def _payload(self, value):
        if value is None:
            return {}
        if not isinstance(value, dict):
            self._fail("WATER_CONTEXT_INPUT", "Supply a context input object.")
        return value

    def _analysis_id(self, payload):
        values = [payload[key] for key in ("analysis_id", "id", "view_id")
                  if payload.get(key) is not None]
        if not values:
            self._fail("WATER_CONTEXT_ANALYSIS", "Select a saved context analysis.")
        if any(value != values[0] for value in values[1:]):
            self._fail("WATER_CONTEXT_ANALYSIS", "Select one saved context analysis.")
        try:
            return identifier(values[0])
        except (ValueError, TypeError) as error:
            self._fail("WATER_CONTEXT_ANALYSIS", str(error))

    def _record(self, workspace, key):
        try:
            return water_context.get_saved(workspace, key)
        except FileNotFoundError:
            self._fail("WATER_CONTEXT_MISSING", "The selected context analysis is absent.", 404)
        except (ValueError, KeyError) as error:
            self._fail("WATER_CONTEXT_RECORD", str(error))

    def _selection(self, workspace, payload):
        has_selection = payload.get("selection") is not None
        has_id = payload.get("selection_id") is not None
        if has_selection == has_id:
            self._fail("WATER_CONTEXT_SELECTION",
                       "Supply a source selection or a saved selection ID.")
        if has_selection:
            value = payload["selection"]
        else:
            try:
                value = workspace._get("water-context-selections",
                                       identifier(payload["selection_id"]))
            except FileNotFoundError:
                self._fail("WATER_CONTEXT_SELECTION", "The saved context selection is absent.", 404)
            except (ValueError, TypeError) as error:
                self._fail("WATER_CONTEXT_SELECTION", str(error))
            value = {key: item for key, item in value.items() if key not in ("id", "schema")}
        if not isinstance(value, dict):
            self._fail("WATER_CONTEXT_SELECTION", "Supply a context source selection object.")
        return value

    def _downloads(self, workspace_key, workspace, record):
        if record.get("state") != "complete":
            return []
        directory = workspace.root / "water-context" / identifier(record["id"])
        result = []
        files = record.get("files", {})
        ordered = [key for key in FILE_ORDER if key in files]
        ordered.extend(sorted(set(files) - set(ordered)))
        for key in ordered:
            expected = files[key]
            path = relative_file(directory, expected["path"])
            ticket = self.operator._ticket(workspace_key, path, expected,
                                           FILE_LABELS.get(key, path.name))
            result.append({**ticket, "artifact": key})
        return result

    def state(self, workspace_key):
        """State refresh reads saved JSON metadata; original GIS files stay closed."""
        workspace = self.operator.ws(workspace_key)
        return {"schema": STATE_SCHEMA, "method": water_context.METHOD,
                "analyses": water_context.list_saved(workspace)}

    def read(self, workspace_key, operation, payload=None):
        workspace = self.operator.ws(workspace_key)
        payload = self._payload(payload)
        if operation == "catalog":
            return water_context.catalog(workspace)
        if operation == "list":
            return self.state(workspace_key)
        if operation not in ("analysis", "preview"):
            self._fail("WATER_CONTEXT_OPERATION", "Choose a registered context read operation.", 404)
        key = self._analysis_id(payload)
        record = self._record(workspace, key)
        if operation == "preview":
            try:
                return water_context.preview(workspace, key)
            except (ValueError, FileNotFoundError, KeyError) as error:
                self._fail("WATER_CONTEXT_PREVIEW", str(error))
        value = {**record, "_downloads": self._downloads(workspace_key, workspace, record),
                 "boundary_summaries": []}
        if record.get("state") == "complete":
            directory = workspace.root / "water-context" / key
            try:
                path = verify_file(directory, record["files"]["boundary_summaries_json"])
                value["boundary_summaries"] = read_json(path)["boundaries"]
            except (ValueError, FileNotFoundError, KeyError) as error:
                self._fail("WATER_CONTEXT_EXPORT", str(error))
        return value

    def invoke(self, task):
        if task.get("action") != ACTION:
            self._fail("WATER_CONTEXT_ACTION", "This provider handles context builds.", 404)
        workspace = self.operator.ws(task["workspace"])
        payload = self._payload(task.get("payload"))
        selection = self._selection(workspace, payload)
        record = water_context.build(workspace, selection)
        return {"kind": ITEM_KIND, "id": record["id"], "analysis_id": record["id"],
                "title": record["title"], "state": record["state"],
                "selection_id": record["selection_id"], "summary": record["summary"]}

    def decorate_task(self, task):
        """Register original verified tickets without rehashing on task refresh."""
        if task.get("action") != ACTION or task.get("state") != "complete":
            return task
        result = task.get("result") or {}
        key = result.get("analysis_id") or result.get("id")
        if not key:
            return task
        workspace_key = task["workspace"]
        workspace = self.operator.ws(workspace_key)
        record = self._record(workspace, identifier(key))
        task["_downloads"] = self._downloads(workspace_key, workspace, record)
        return task

    def verify_workspace(self, workspace):
        """Inspect retained analyses through the existing explicit receiving flow."""
        result = water_context.verify_all(workspace)
        unfinished = [row for row in result["errors"]
                      if row.get("state") in ("building", "failed")
                      and row.get("error") == "Analysis exports are not complete"]
        errors = [row for row in result["errors"] if row not in unfinished]
        if errors:
            details = "; ".join(row["id"] + ": " + row["error"] for row in errors[:5])
            self._fail("WATER_CONTEXT_RECEIVE", "Context archive verification failed: " + details)
        return {**result, "ok": True, "errors": [], "unfinished": unfinished}

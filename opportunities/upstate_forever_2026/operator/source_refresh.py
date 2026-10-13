"""Source-edition updates inside the original Upper Savannah operator."""
from __future__ import annotations
import copy
import json
import re
from pathlib import Path
import urllib.parse
from model import source_refresh
# Retain the original SourceRefresh transport and its native handler binding.
from source_refresh_legacy import Response, encoded, dispatch, extend_handler

ACTIONS = {"source.refresh.plan", "source.refresh.apply", "source.refresh.landcover", "source.refresh.report_source"}
PAGES = {
    "/web/source-refresh.html": ("source-refresh.html", "text/html; charset=utf-8"),
    "/web/source-refresh.mjs": ("source-refresh.mjs", "text/javascript; charset=utf-8"),
    "/web/source-refresh-nav.mjs": ("source-refresh-nav.mjs", "text/javascript; charset=utf-8"),
    "/web/source-refresh.css": ("source-refresh.css", "text/css; charset=utf-8"),
}

def _boolean(value, name, default=False):
    value = value.get(name, default)
    if not isinstance(value, bool):
        raise ValueError(name + " must be true or false")
    return value

def _source_year(entry):
    metadata = entry.get("metadata") or {}
    years = set()
    for value in (entry.get("year"), metadata.get("year"),
                  metadata.get("product_year"), entry.get("source_time"),
                  entry.get("vintage") if re.fullmatch(r"\d{4}", str(entry.get("vintage", "")).strip()) else None):
        if value in (None, ""):
            continue
        match = re.fullmatch(r"(\d{4})(?:-\d{2}-\d{2}(?:[T ].*)?)?", str(value).strip())
        if match:
            years.add(int(match.group(1)))
    if len(years) > 1:
        raise ValueError("The retained source declares conflicting raster years")
    return next(iter(years)) if years else None

def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Choose the two retained source editions")
    allowed = {"from_collection_id", "to_collection_id", "source_id_map", "title"}
    unknown = set(value) - allowed
    if unknown:
        raise ValueError("Unknown source-update selection fields: " + ", ".join(sorted(unknown)))
    result = copy.deepcopy(value)
    if not result.get("from_collection_id") or not result.get("to_collection_id"):
        raise ValueError("Select both the earlier and replacement source edition")
    if result["from_collection_id"] == result["to_collection_id"]:
        raise ValueError("Choose two different retained source editions")
    if "source_id_map" in result and not isinstance(result["source_id_map"], dict):
        raise ValueError("Source replacements must map original source IDs to replacement IDs")
    return result

def state(workspace):
    return {"project": workspace.project, "sources": workspace.sources(), **updates(workspace)}

def _landcover(operator, task):
    from source_tools.landcover_change import compare_landcover
    ws = operator.ws(task["workspace"])
    value = task["payload"]
    selected = {}
    for side in ("from", "to"):
        collection = value.get(side + "_collection_id")
        source_id = value.get(side + "_source_id")
        if not collection or not source_id:
            raise ValueError("Choose both retained land-cover rasters")
        path, entry = ws.source_file(collection, source_id)
        if entry.get("kind") != "raster":
            raise ValueError("Land-cover comparison needs the original classified rasters")
        entry = copy.deepcopy(entry)
        entry["source_collection_id"] = collection
        native_year = _source_year(entry)
        declared = value.get(side + "_year")
        if declared not in (None, ""):
            try:
                year = int(declared)
            except (TypeError, ValueError):
                raise ValueError("Land-cover year must be an integer")
            if isinstance(declared, bool) or float(declared) != year:
                raise ValueError("Land-cover year must be an integer")
            if not 1985 <= year <= 2100:
                raise ValueError("Choose the calendar year of the original land-cover raster")
            if native_year and int(native_year) != year:
                raise ValueError("The selected year differs from the retained source's year")
            entry["year"] = year
            entry["year_selection"] = "Retained source year" if native_year else "Operator-declared raster year"
        elif native_year:
            entry["year"] = native_year
            entry["year_selection"] = "Retained source year"
        selected[side] = (path, entry)
    kwargs = {
        "align_to_from": _boolean(value, "align_to_from"),
        "polygonize": _boolean(value, "polygonize", True),
        "from_classes": value.get("from_classes"),
        "to_classes": value.get("to_classes"),
    }
    if value.get("zone_source_id"):
        zone_path, zone_entry = ws.source_file(value.get("zone_collection_id"), value["zone_source_id"])
        if zone_entry.get("kind") != "vector":
            raise ValueError("Zone summaries need retained polygon geometry")
        zone_entry = copy.deepcopy(zone_entry)
        zone_entry["source_collection_id"] = value["zone_collection_id"]
        kwargs.update(zones=zone_path, zone_source=zone_entry,
                      zone_id_field=value.get("zone_id_field") or "huc12",
                      zone_layer=value.get("zone_layer") or zone_entry.get("layer"))
    output = ws.root / "landcover-change-output" / task["id"]
    result = compare_landcover(selected["from"][0], selected["to"][0], output,
                               selected["from"][1], selected["to"][1], **kwargs)
    manifest = output / "sources.json"
    if not manifest.is_file():
        raise ValueError("Land-cover comparison did not produce its original source manifest")
    collection = ws.import_sources(manifest)
    record = ws._save("landcover-changes", {
        "title": value.get("title") or "Land-cover change",
        "created_at": task["created_at"], "operation_id": task["operation_id"],
        "source_collection_id": collection["id"],
        "from_collection_id": value["from_collection_id"],
        "from_source_id": value["from_source_id"],
        "to_collection_id": value["to_collection_id"],
        "to_source_id": value["to_source_id"],
        "comparison": json.loads((output / "summary.json").read_text(encoding="utf-8")),
    })
    return {"record": record, "source_collection_id": collection["id"],
            "title": collection["title"], "entries": collection["entries"]}

def invoke(operator, task):
    ws = operator.ws(task["workspace"])
    value = task["payload"]
    if task["action"] == "source.refresh.report_source":
        from model.source_refresh_report_source import prepare
        return prepare(ws, value)
    if task["action"] == "source.refresh.plan":
        return source_refresh.save_plan(ws, _selection(value))
    if task["action"] == "source.refresh.apply":
        if not value.get("plan_id"):
            raise ValueError("Choose a saved source-update plan")
        result = source_refresh.apply_plan(ws, value["plan_id"],
                                           run_models=_boolean(value, "run_models"))
        if result.get("state") == "failed":
            messages = [row.get("message", "Native execution failed") for row in result.get("errors", [])]
            raise RuntimeError("Source update retained its progress: " + "; ".join(messages))
        return result
    if task["action"] == "source.refresh.landcover":
        return _landcover(operator, task)
    raise ValueError("Unsupported source-update action")


def updates(workspace):
    """Contribute only owned records; the original state already has sources."""
    from model.source_refresh_report_source import list_sources
    return {"plans": source_refresh.list_plans(workspace),
            "landcover_changes": workspace._list("landcover-changes"),
            "report_sources": list_sources(workspace)}

def read(workspace, operation, payload):
    """Explicit bindings for the cumulative operator's authenticated routes."""
    if operation == "catalog":
        return state(workspace)
    if operation == "plan":
        plan_id = payload.get("id")
        if not isinstance(plan_id, str) or not plan_id:
            raise ValueError("Choose a saved source-update plan")
        return source_refresh.get_plan(workspace, plan_id)
    if operation == "report":
        plan_id = payload.get("id")
        if not isinstance(plan_id, str) or not plan_id:
            raise ValueError("Choose a saved source-update plan")
        return source_refresh.report_plan(workspace, plan_id)
    if operation == "preview":
        return source_refresh.preview(workspace, _selection(payload.get("selection", {})))
    raise ValueError("Unsupported source-update read operation")

def install(namespace):
    """Install additive routes while retaining other operator extensions."""
    if namespace.get("_SOURCE_REFRESH_INSTALLED") or "ExtensionRegistry" in namespace:
        return
    namespace["ACTIONS"] = set(namespace["ACTIONS"]) | ACTIONS
    Operator, Handler = namespace["Operator"], namespace["Handler"]
    previous_invoke = Operator._invoke
    previous_get, previous_post = Handler.do_GET, Handler.do_POST

    def wrapped_invoke(self, task):
        if task["action"] in ACTIONS:
            return invoke(self, task)
        return previous_invoke(self, task)

    def wrapped_get(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path not in PAGES and url.path not in {
                "/api/source-refresh", "/api/source-refresh/plan", "/api/source-refresh/report"}:
            return previous_get(self)
        try:
            self.check_host()
            if url.path in PAGES:
                filename, mime = PAGES[url.path]
                body = (Path(__file__).parent / "web" / filename).read_bytes()
                self.close_connection = True
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Content-Security-Policy",
                                 "default-src 'self'; script-src 'self'; style-src 'self'; "
                                 "img-src 'self' data:; object-src 'none'; base-uri 'none'; "
                                 "form-action 'self'; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(body)
                return
            self.authorized()
            query = urllib.parse.parse_qs(url.query)
            key = query.get("workspace", [self.app.primary])[0]
            ws = self.app.ws(key)
            if url.path == "/api/source-refresh":
                return self.send_json(200, state(ws))
            plan_id = query.get("id", [None])[0]
            if not plan_id:
                raise ValueError("Choose a saved source-update plan")
            if url.path == "/api/source-refresh/report":
                return self.send_json(200, source_refresh.report_plan(ws, plan_id))
            return self.send_json(200, source_refresh.get_plan(ws, plan_id))
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            return self.fail(error)

    def wrapped_post(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path != "/api/source-refresh/preview":
            return previous_post(self)
        try:
            self.authorized()
            value = self.body()
            ws = self.app.ws(value.get("workspace", self.app.primary))
            return self.send_json(200, source_refresh.preview(ws, _selection(value.get("selection", {}))))
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            return self.fail(error)

    Operator._invoke = wrapped_invoke
    Handler.do_GET, Handler.do_POST = wrapped_get, wrapped_post
    namespace["_SOURCE_REFRESH_INSTALLED"] = True

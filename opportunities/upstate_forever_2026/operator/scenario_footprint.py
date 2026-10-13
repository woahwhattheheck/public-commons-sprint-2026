"""Original-operator queue, catalogue and downloads for native scenario footprints."""
from __future__ import annotations
import copy
from pathlib import Path
import urllib.parse
from model.common import read_json, relative_file
from model import scenario_footprint

ACTIONS = {"scenario.footprint.preview"}
PAGES = {"/web/" + name: (name, mime) for name, mime in (
    ("scenario-footprint.html", "text/html; charset=utf-8"),
    ("scenario-footprint.css", "text/css; charset=utf-8"),
    ("scenario-footprint.mjs", "text/javascript; charset=utf-8"),
    ("scenario-footprint-nav.mjs", "text/javascript; charset=utf-8"))}


def dispatch(workspace, action, payload):
    if action != "scenario.footprint.preview":
        raise ValueError("Choose the native scenario footprint action")
    if not isinstance(payload, dict) or set(payload) != {"run_id"}:
        raise ValueError("Select the retained native run to preview")
    return scenario_footprint.preview_run(workspace, payload["run_id"])


def state_snapshot(operator, workspace_key):
    """Expose retained input accounting in the ordinary workspace overview.

    This reads immutable preview records only. It never compiles a scenario or
    starts a model while the operator polls its current workspace.
    """
    records = []
    for row in scenario_footprint.list_footprints(operator.ws(workspace_key)):
        request = row.get("request") or {}
        records.append({
            "id": row["id"], "run_id": row["run_id"],
            "title": row.get("title"), "created_at": row.get("created_at"),
            "selection": copy.deepcopy(row.get("selection", {})),
            "summary": copy.deepcopy(row.get("summary", {})),
            "notes": copy.deepcopy(row.get("notes", [])),
            "compiler_version": request.get("compiler_version"),
            "compiler_sha256": request.get("compiler_sha256"),
        })
    records.sort(key=lambda row: (str(row.get("created_at") or ""), row["id"]), reverse=True)
    return {"schema": "upstate.scenario-footprint-state/v1", "records": records}


def catalog(operator, workspace_key, offset=0, limit=100):
    ws = operator.ws(workspace_key)
    offset, limit = int(offset), int(limit)
    if offset < 0 or not 1 <= limit <= 200:
        raise ValueError("Choose a valid run catalogue page")
    paths = sorted((ws.root / "runs").glob("*/run.json"))
    profiles = {p["id"]: p["title"] for p in ws._list("profiles")}
    scenarios = {p["id"]: p["title"] for p in ws._list("scenarios")}
    runs = []
    for path in paths[offset:offset + limit]:
        row = read_json(path)
        selection = row["selection"]
        runs.append({"id": row["id"], "state": row["state"], "selection": selection,
                     "profile_title": profiles.get(selection["profile_id"], selection["profile_id"]),
                     "scenario_title": scenarios.get(selection["scenario_id"], selection["scenario_id"])})
    summaries = [{k: row[k] for k in ("id", "title", "run_id", "created_at", "selection", "summary")}
                 for row in scenario_footprint.list_footprints(ws)]
    return {"workspace_key": workspace_key, "project": ws.project,
            "workspaces": operator.public_workspaces(), "runs": runs,
            "offset": offset, "limit": limit, "total_runs": len(paths),
            "next_offset": offset + limit if offset + limit < len(paths) else None,
            "footprints": sorted(summaries, key=lambda row: row["created_at"], reverse=True)}


def report(operator, workspace_key, report_id):
    ws = operator.ws(workspace_key)
    value = scenario_footprint.get_footprint(ws, report_id, verify=False)
    result = copy.deepcopy(value)
    result["_downloads"] = []
    for name, item in value["files"].items():
        path = relative_file(ws.root, item["path"])
        ticket = operator._ticket(workspace_key, path, item, name.replace("_", " "))
        ticket["artifact_id"] = name
        result["_downloads"].append(ticket)
    return result



def invoke(operator, task):
    """Bind an admitted task from the existing extension host."""
    return dispatch(operator.ws(task["workspace"]), task["action"], task["payload"])


def read(operator, workspace_key, operation, payload):
    if not isinstance(payload, dict):
        raise ValueError("Use the original route input object")
    if operation == "catalog":
        return catalog(operator, workspace_key, payload.get("offset", 0), payload.get("limit", 100))
    if operation == "report":
        return report(operator, workspace_key, payload.get("id"))
    raise ValueError("Choose the footprint catalogue or retained report")


def decorate_task(operator, task):
    if task.get("action") in ACTIONS and task.get("state") == "complete":
        task["_downloads"] = report(operator, task["workspace"], task["result"]["id"])["_downloads"]
    return task


def verify_workspace(workspace):
    rows = scenario_footprint.list_footprints(workspace)
    for row in rows:
        scenario_footprint.get_footprint(workspace, row["id"], verify=True)
    return {"footprints": len(rows)}


def install(namespace):
    """Compose with the same operator auth/queue and any already-installed routes."""
    if namespace.get("ExtensionRegistry") is not None or namespace.get("_SCENARIO_FOOTPRINT_INSTALLED"):
        return
    namespace["ACTIONS"] = set(namespace["ACTIONS"]) | ACTIONS
    Operator, Handler = namespace["Operator"], namespace["Handler"]
    previous_invoke, previous_get = Operator._invoke, Handler.do_GET

    def invoke(self, task):
        if task["action"] in ACTIONS:
            return dispatch(self.ws(task["workspace"]), task["action"], task["payload"])
        return previous_invoke(self, task)

    def get(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path not in PAGES and url.path not in {
                "/api/scenario-footprints/catalog", "/api/scenario-footprints/report"}:
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
            one = lambda key, default=None: query.get(key, [default])[0]
            workspace_key = one("workspace", self.app.primary)
            if url.path.endswith("/catalog"):
                return self.send_json(200, catalog(self.app, workspace_key,
                                                   one("offset", "0"), one("limit", "100")))
            return self.send_json(200, report(self.app, workspace_key, one("id")))
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            return self.fail(error)

    Operator._invoke, Handler.do_GET = invoke, get
    namespace["_SCENARIO_FOOTPRINT_INSTALLED"] = True

"""Routes behind the existing private Analysis capability."""
from . import _analysis_event_programmes_ui as ui
from .errors import StateError


def assets():
    return {"/event-programmes": (ui.HTML, "text/html;charset=utf-8"),
            "/event-programmes.js": (ui.JS, "text/javascript;charset=utf-8"),
            "/event-programmes.css": (ui.CSS, "text/css;charset=utf-8")}


def get(handler, workspace, url, query, parts):
    if handler.command not in {"GET", "HEAD"} or parts[:2] != ["api", "event-programmes"]:
        return False
    api = workspace.event_programmes
    value = lambda key: query.get(key, [None])[0]
    if len(parts) == 2:
        if set(query) - {"actions_before", "inputs_before", "limit"}:
            raise StateError("EVENT_PROGRAMME_PAGE_INVALID")
        result = api.overview(actions_before=int(value("actions_before")) if value("actions_before") else None,
                              inputs_before=int(value("inputs_before")) if value("inputs_before") else None,
                              limit=int(value("limit")) if value("limit") else 25)
    elif len(parts) == 4 and parts[2] == "inputs" and not query:
        result = api.input_status(parts[3])
    elif len(parts) == 5 and parts[2] == "inputs" and parts[4] == "fields" and not query:
        result = api.inspect_input(parts[3])
    elif len(parts) == 4 and parts[2] == "actions" and not query:
        result = api.action(parts[3])
    elif len(parts) == 4 and parts[2] == "named" and not query:
        result = api.programme(parts[3])
    elif len(parts) == 7 and parts[2] == "named" and parts[4] == "delivery" and not query:
        path, record = api.download(parts[3], parts[5], parts[6])
        handler._file_reply(path, record)
        return True
    else:
        raise StateError("EVENT_PROGRAMME_ROUTE_INVALID")
    handler._reply(200, result)
    return True


def post(handler, workspace, url, parts, body):
    if parts[:2] != ["api", "event-programmes"]:
        return False
    api = workspace.event_programmes
    if len(parts) == 3 and parts[2] == "inputs":
        result = api.create_input(body)
    elif len(parts) == 5 and parts[2] == "inputs" and parts[4] == "inspect":
        if not isinstance(body, dict) or set(body) - {"pointer", "offset", "limit"} or "pointer" not in body:
            raise StateError("EVENT_PROGRAMME_FIELD_PAGE_INVALID")
        result = api.inspect_input(parts[3], pointer=body["pointer"],
                                   offset=body.get("offset", 0), limit=body.get("limit", 25))
    elif len(parts) == 5 and parts[2] == "inputs":
        result = api.chunk(parts[3], parts[4], body)
    elif len(parts) == 5 and parts[2] == "named" and parts[4] == "actions":
        result = api.start(parts[3], body)
    else:
        raise StateError("EVENT_PROGRAMME_ROUTE_INVALID")
    handler._reply(200, result)
    return True

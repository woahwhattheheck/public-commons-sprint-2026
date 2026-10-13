"""Private same-owner HTTP and assets for approved World Bank handover intake."""
from . import _analysis_worldbank_intake_ui
from .errors import StateError
from ._analysis_export_http import send_export

def assets():
    return {"/worldbank-intake": (_analysis_worldbank_intake_ui.HTML, "text/html;charset=utf-8"),
            "/worldbank-intake.js": (_analysis_worldbank_intake_ui.JS, "text/javascript;charset=utf-8"),
            "/worldbank-intake.css": (_analysis_worldbank_intake_ui.CSS, "text/css;charset=utf-8")}


def get(handler, workspace, url, query, parts):
    if handler.command not in {"GET", "HEAD"} or parts[:2] != ["api", "worldbank-intake"]:
        return False
    intake = workspace.worldbank_intake
    if len(parts) == 2 and handler.command == "GET":
        if set(query) - {"before", "limit"}:
            raise StateError("WORLDBANK_INTAKE_PAGE_INVALID")
        before = query.get("before", [None])[0]
        handler._reply(200, intake.history(before=int(before) if before else None,
                                         limit=int(query.get("limit", ["25"])[0])))
    elif len(parts) == 3 and handler.command == "GET":
        if query:
            raise StateError("WORLDBANK_INTAKE_QUERY_INVALID")
        handler._reply(200, intake.status(parts[2]))
    elif len(parts) == 4 and parts[3] == "original":
        if query:
            raise StateError("WORLDBANK_INTAKE_QUERY_INVALID")
        delivery, record = intake.original(parts[2])
        with delivery.open() as stream:
            send_export(handler, stream, record)
    else:
        return False
    return True


def post(handler, workspace, url, parts, body):
    if parts[:2] != ["api", "worldbank-intake"]:
        return False
    intake = workspace.worldbank_intake
    if len(parts) == 2:
        handler._reply(200, intake.begin(body))
    elif len(parts) == 4 and parts[3] == "chunks":
        handler._reply(200, intake.chunk(parts[2], body))
    elif len(parts) == 4 and parts[3] == "register":
        if set(body) - {"resume"}:
            raise StateError("WORLDBANK_INTAKE_REGISTER_FIELDS_INVALID")
        handler._reply(202, intake.register(parts[2], resume=body.get("resume", False)))
    else:
        return False
    return True

"""HTTP joins for the original World Bank recurring engine and live Analysis owner."""
from urllib.parse import unquote

from .errors import StateError


def _page(query, *, names=False):
    if set(query) - {"before", "limit"} or any(len(v) != 1 for v in query.values()):
        raise StateError("WORLDBANK_PROGRAMME_PAGE_INVALID")
    before = query.get("before", [None])[0]
    limit = int(query.get("limit", ["50"])[0])
    if not 1 <= limit <= 100:
        raise StateError("WORLDBANK_PROGRAMME_PAGE_INVALID")
    if before is not None and not names:
        before = int(before)
        if before < 1:
            raise StateError("WORLDBANK_PROGRAMME_PAGE_INVALID")
    return {"before": before, "limit": limit}


def get(handler, workspace, url, query, parts):
    if handler.command not in {"GET", "HEAD"} or parts[:2] != ["api", "worldbank-programmes"]:
        return False
    manager = workspace.worldbank_programmes
    if len(parts) == 2 and handler.command == "GET":
        handler._reply(200, manager.list(**_page(query, names=True)))
    elif len(parts) == 3 and parts[2] == "sources" and handler.command == "GET":
        handler._reply(200, manager.sources(**_page(query)))
    elif len(parts) == 3 and handler.command == "GET":
        if query:
            raise StateError("WORLDBANK_PROGRAMME_QUERY_INVALID")
        handler._reply(200, manager.definition(unquote(parts[2])))
    elif len(parts) == 4 and parts[3] == "history" and handler.command == "GET":
        handler._reply(200, manager.history(unquote(parts[2]), **_page(query)))
    elif len(parts) >= 5 and parts[3] == "operations":
        name, operation = unquote(parts[2]), parts[4]
        if query:
            raise StateError("WORLDBANK_PROGRAMME_QUERY_INVALID")
        if len(parts) == 5 and handler.command == "GET":
            handler._reply(200, manager.status(name, operation))
        elif len(parts) == 6 and parts[5] == "review" and handler.command == "GET":
            handler._reply(200, manager.review(name, operation))
        elif len(parts) == 7 and parts[5] == "files":
            path, record = manager.download(name, operation, unquote(parts[6]))
            # Reuse the original descriptor verification and streaming response.
            handler._file_reply(path, record)
        else:
            return False
    else:
        return False
    return True


def post(handler, workspace, url, parts, body):
    if parts[:2] != ["api", "worldbank-programmes"]:
        return False
    manager = workspace.worldbank_programmes
    if len(parts) == 3:
        if parts[2] == "sources":
            raise StateError("WORLDBANK_PROGRAMME_RESERVED_NAME")
        handler._reply(200, manager.save(unquote(parts[2]), body))
    elif len(parts) == 4 and parts[3] in ("prepare", "reopen"):
        handler._reply(202, getattr(manager, parts[3])(unquote(parts[2]), body))
    elif len(parts) == 6 and parts[3] == "operations" and parts[5] == "publish":
        if body.get("id") != parts[4]:
            raise StateError("WORLDBANK_PROGRAMME_OPERATION_ID_CHANGED")
        handler._reply(202, manager.publish(unquote(parts[2]), body))
    else:
        return False
    return True

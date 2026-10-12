"""MIT. Shared console/CLI actions for the retained feed product."""
from feed_workspace import InputError

def execute(ws, body):
    if not isinstance(body, dict):
        raise InputError("Choose a feed action")
    action = body.get("action")
    options = {
        "collection-save": {"collectionId", "title", "members", "newFeeds", "expectedRevision", "operationId"},
        "collection-capture": {"collectionId", "expectedRevision", "expectedRevisions", "operationId", "pageLimit", "force"},
        "collection-resume": {"runId"},
        "collection-edition": {"runId", "name", "fields", "expectedRevisions", "operationId"},
        "register": {"feedId", "config", "expectedRevision", "operationId"},
        "capture": {"feedId", "operationId", "followPages", "pageLimit", "force", "fromCapture"},
        "resume": {"captureId"},
        "apply": {"captureId", "expectedRevision", "operationId", "decisions", "acceptIdentity"},
        "annotate": {"feedId", "identity", "expectedRevision", "operationId", "note", "tags", "starred"},
        "edition": {"feedIds", "name", "fields", "expectedRevisions", "operationId"},
        "query": {"editionId", "params"},
        "compare": {"beforeId", "afterId"},
    }
    if action not in options or set(body) - options[action] - {"action"}:
        raise InputError("Unknown action or action option")
    if action == "collection-save":
        return ws.subscriptions.save(body["collectionId"], body["title"], body["members"], body.get("newFeeds", {}), body["expectedRevision"], body["operationId"])
    if action == "collection-capture":
        return ws.subscriptions.capture(body["collectionId"], body["expectedRevision"], body["expectedRevisions"], body["operationId"], body.get("pageLimit", 100), body.get("force", False))
    if action == "collection-resume":
        return ws.subscriptions.resume(body["runId"])
    if action == "collection-edition":
        return ws.subscriptions.edition(body["runId"], body["name"], body["fields"], body["expectedRevisions"], body["operationId"])
    if action == "register":
        return ws.register(body["feedId"], body["config"], body["expectedRevision"], body["operationId"])
    if action == "capture":
        return ws.capture(body["feedId"], body["operationId"], follow_pages=body.get("followPages", True),
                          page_limit=body.get("pageLimit", 100), force=body.get("force", False),
                          from_capture=body.get("fromCapture"))
    if action == "resume":
        return ws.resume_capture(body["captureId"])
    if action == "apply":
        return ws.apply(body["captureId"], body["expectedRevision"], body["operationId"],
                        body.get("decisions"), body.get("acceptIdentity", False))
    if action == "annotate":
        return ws.annotate(body["feedId"], body["identity"], body["expectedRevision"], body["operationId"],
                           note=body.get("note", ""), tags=body.get("tags"), starred=body.get("starred", False))
    if action == "edition":
        return ws.edition_summary(ws.edition(body["feedIds"], body["name"], body["fields"],
                                 body["operationId"], body["expectedRevisions"]))
    if action == "query":
        return ws.query(ws.edition_view(body["editionId"])["buildId"], body.get("params", {}))
    if action == "compare":
        return ws.compare(ws.edition_view(body["beforeId"])["buildId"], ws.edition_view(body["afterId"])["buildId"])

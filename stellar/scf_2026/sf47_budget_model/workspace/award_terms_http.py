"""Original authenticated HTTP routes for issuer receiving and native commissioning."""
from urllib.parse import parse_qs
import re

from model import Problem


def optional_int(query, name):
    value = query.get(name, [None])[0]
    try:
        return None if value is None else int(value)
    except ValueError as exc:
        raise Problem("Use an original terms revision and case version.", 422, "INVALID_AWARD_TERMS") from exc


def handle(handler, parsed, operations, method):
    match = re.fullmatch(r"/api/operations/(operation-[a-f0-9]{32})/(award-terms(?:/terms-[a-f0-9]{32}(?:/export\.zip)?)?|award-terms-(?:seed|preview|plan-seed|plan-preview|commission)|issuer-correspondence/source-[a-f0-9]{32}|issuer-correspondence-(?:inspect|receive))", parsed.path)
    if not match:
        return False
    program_id, route = match.groups()
    query = parse_qs(parsed.query)
    if method == "GET":
        if route == "award-terms":
            handler.send(200, operations.list_award_terms(program_id))
        elif route.startswith("issuer-correspondence/"):
            handler.send(200, operations.issuer_correspondence(program_id, route.split("/")[1]))
        elif route.startswith("award-terms/"):
            terms_id = route.split("/")[1]
            revision = optional_int(query, "revision")
            if route.endswith("/export.zip"):
                handler.send(200, operations.export_award_terms(program_id, terms_id, revision,
                    optional_int(query, "expectedVersion")), "application/zip", terms_id + "-complete-case.zip")
            else:
                handler.send(200, operations.award_terms(program_id, terms_id, revision))
        else:
            raise Problem("Use the documented issuer receiving method.", 405, "METHOD_NOT_ALLOWED")
    elif method == "POST":
        methods = {
            "award-terms-seed": operations.seed_award_terms,
            "award-terms-preview": operations.preview_award_terms,
            "award-terms-plan-seed": operations.seed_award_terms_plan,
            "award-terms-plan-preview": operations.preview_award_terms_plan,
            "award-terms-commission": operations.commission_award_terms,
            "issuer-correspondence-inspect": operations.inspect_issuer_correspondence,
            "issuer-correspondence-receive": operations.receive_issuer_correspondence,
        }
        if route not in methods:
            raise Problem("Use the documented issuer receiving method.", 405, "METHOD_NOT_ALLOWED")
        handler.send(200, methods[route](program_id, handler.json_body()))
    else:
        raise Problem("Use the documented issuer receiving method.", 405, "METHOD_NOT_ALLOWED")
    return True

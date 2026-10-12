"""MIT. Native yente request preparation, single dispatch and retained response intake.

Uses the published /match, /entities, /catalog and /statements contracts.
Credentials are environment references. Exact source request and response bytes
stay with the original operation; an uncertain POST is never sent a second time.
"""
from __future__ import annotations

import io
import os
import re
import time
from urllib.parse import urlsplit, quote, urlencode
import urllib.error
import urllib.request

from model import (InputError, DATASET, json_bytes, load_json, sha, text, bounded_int,
                   ftm_entity, MAX_SOURCE)

AUTH_ENV = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}\Z")
PARAMS = {"limit", "threshold", "algorithm", "include_dataset", "exclude_dataset",
          "exclude_schema", "topics", "changed_since", "exclude_entity_ids"}
MULTI = {"include_dataset", "exclude_dataset", "exclude_schema", "topics", "exclude_entity_ids"}
ALGORITHMS = {"best", "logic-v2", "ofac", "name-based", "name-qualified", "logic-v1", "regression-v1"}
SAFE_HEADERS = {"date", "content-type", "content-length", "etag", "last-modified", "server",
                "x-request-id", "x-correlation-id", "retry-after", "x-yente-version",
                "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"}

def endpoint_url(value):
    p = urlsplit(text(value, "yente endpoint", 2000))
    if not p.hostname or p.username or p.password or p.query or p.fragment:
        raise InputError("Use the exact yente service base URL without credentials or query parameters")
    if p.scheme != "https" and not (p.scheme == "http" and p.hostname in {"localhost", "127.0.0.1", "::1"}):
        raise InputError("Use HTTPS for the yente endpoint, or HTTP for a local native receiver")
    return value.rstrip("/")

def native_params(raw):
    if not isinstance(raw, dict) or set(raw) - PARAMS:
        raise InputError("Choose published yente matching query parameters")
    out = {}
    for key, value in raw.items():
        if key in MULTI:
            if not isinstance(value, list) or len(value) > (50 if key == "exclude_entity_ids" else 100) or any(type(v) is not str or not v for v in value):
                raise InputError(f"{key} requires explicit native string values")
            out[key] = value
        elif key == "limit":
            out[key] = bounded_int(value, 1, 500, "Native match limit")
        elif key == "threshold":
            if type(value) not in {int, float} or not 0 <= value <= 1:
                raise InputError("Native matching threshold must be between zero and one")
            out[key] = value
        elif key == "algorithm":
            if value not in ALGORITHMS:
                raise InputError("Select a published native yente algorithm")
            out[key] = value
        elif key == "changed_since":
            if not isinstance(value, str) or not re.fullmatch(r"\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}(?::\d{2}(?::\d{2})?)?)?)?)?", value):
                raise InputError("Use the published partial ISO date format for changed_since")
            out[key] = value
    return out

def save_profile(domain, raw):
    if not isinstance(raw, dict) or set(raw) - {"label", "endpoint", "dataset", "auth", "parameters", "config", "weights", "sourceNote"}:
        raise InputError("Use the native yente profile contract")
    endpoint = endpoint_url(raw.get("endpoint"))
    dataset = raw.get("dataset")
    if not isinstance(dataset, str) or not DATASET.fullmatch(dataset):
        raise InputError("Choose the exact service dataset or collection name")
    auth = raw.get("auth", {"kind": "none"})
    if not isinstance(auth, dict) or auth.get("kind") not in {"none", "ApiKey", "Bearer"}:
        raise InputError("Use a native API-key/Bearer environment reference or explicit unauthenticated local service")
    if auth["kind"] != "none":
        if set(auth) != {"kind", "env"} or not AUTH_ENV.fullmatch(auth.get("env", "")):
            raise InputError("Credentials must be named environment references")
    elif set(auth) != {"kind"}:
        raise InputError("An unauthenticated profile has no credential fields")
    if urlsplit(endpoint).hostname == "api.opensanctions.org" and auth["kind"] != "ApiKey":
        raise InputError("The hosted OpenSanctions API requires its ApiKey environment reference")
    parameters = native_params(raw.get("parameters", {"algorithm": "logic-v2", "limit": 10, "threshold": 0.7}))
    config, weights = raw.get("config", {}), raw.get("weights", {})
    if not isinstance(config, dict) or any(type(v) not in {str, int, float, bool, type(None)} for v in config.values()):
        raise InputError("Native algorithm config values must be JSON scalar values")
    if not isinstance(weights, dict) or any(type(v) not in {int, float} for v in weights.values()):
        raise InputError("Native feature weights must be numbers")
    body = {"label": text(raw.get("label"), "Profile label", 160), "endpoint": endpoint, "dataset": dataset,
            "auth": auth, "parameters": parameters, "config": config, "weights": weights,
            "sourceNote": text(raw.get("sourceNote", ""), "Service/entitlement note", 4000, blank=True),
            "contract": {"openapiVersion": "yente 5.5.0", "matching": "/match/{dataset}",
                         "source": "https://api.opensanctions.org/openapi.json"}}
    body["id"] = sha(json_bytes(body))
    with domain.mutex, domain.db:
        domain._put("profiles", body)
    return body

def resolve_headers(profile):
    headers = {"Accept": "application/json", "User-Agent": "Starforge OpenSanctions operator/1.0"}
    auth = profile["auth"]
    if auth["kind"] != "none":
        secret = os.environ.get(auth["env"], "")
        if not secret or "\r" in secret or "\n" in secret:
            raise InputError(f"Set the configured environment reference {auth['env']} before dispatch")
        headers["Authorization"] = auth["kind"] + " " + secret
    return headers

def prepare(domain, profile_id, *, kind="match", portfolio=None, entity_ids=None,
            edition=None, entity_id=None, parameters=None, refresh_key=None):
    profile = domain._one("profiles", profile_id)
    if kind not in {"match", "entity", "catalog", "statements"}:
        raise InputError("Choose a native match, entity refresh, catalog or statement request")
    if refresh_key is not None:
        text(refresh_key, "Explicit new screening/refresh reason", 500)
    body, correlation = None, {}
    request_parameters = {}
    if edition:
        domain._one("editions", edition)
    if kind == "match":
        if not portfolio or not isinstance(entity_ids, list) or not 1 <= len(entity_ids) <= 100 or len(entity_ids) != len(set(entity_ids)):
            raise InputError("Select 1–100 original customer FtM entities for the native request")
        customer = domain._one("portfolios", portfolio)
        queries = {}
        for selected in entity_ids:
            record = domain.entity(portfolio, selected)["entity"]
            # Native correlation keys preserve the original customer's own identity.
            queries[selected] = {"schema": record["schema"], "properties": record["properties"]}
            correlation[selected] = {"portfolio": portfolio, "portfolioKey": customer["key"], "counterpartyId": selected}
        body = {"queries": queries, "config": profile["config"], "weights": profile["weights"]}
        request_parameters = native_params(parameters if parameters is not None else profile["parameters"])
        method, path = "POST", "/match/" + quote(profile["dataset"], safe="")
    elif kind == "entity":
        method, path = "GET", "/entities/" + quote(text(entity_id, "Native entity id", 512), safe="")
    elif kind == "catalog":
        method, path = "GET", "/catalog"
    else:
        parameters = parameters or {}
        allowed = {"dataset", "entity_id", "canonical_id", "prop", "prop_type", "value", "schema", "sort", "limit", "offset"}
        if not isinstance(parameters, dict) or set(parameters) - allowed:
            raise InputError("Use the published native statement query fields")
        request_parameters = dict(parameters)
        request_parameters.setdefault("dataset", profile["dataset"])
        if "limit" in request_parameters:
            bounded_int(request_parameters["limit"], 1, 5000, "Statement page limit")
        if "offset" in request_parameters:
            bounded_int(request_parameters["offset"], 0, 9499, "Statement page offset")
        for key, value in request_parameters.items():
            if key == "sort":
                if not isinstance(value, list) or any(type(v) is not str for v in value):
                    raise InputError("Statement sorting uses native string fields")
            elif key not in {"limit", "offset"} and type(value) is not str:
                raise InputError("Native statement filters must be scalar strings")
        method, path = "GET", "/statements"
    query = urlencode(request_parameters, doseq=True)
    url = profile["endpoint"] + path + ("?" + query if query else "")
    raw = json_bytes(body) if body is not None else b""
    request_object = domain.put_object(io.BytesIO(raw), f"yente-{kind}-request.json", "application/json",
                                       {"url": url, "method": method})
    original = {"schema": "starforge.yente-operation.v1", "profile": profile_id, "kind": kind,
                "method": method, "url": url, "request": request_object["id"], "requestSha256": sha(raw),
                "portfolio": portfolio, "edition": edition, "correlation": correlation,
                "parameters": request_parameters, "refreshKey": refresh_key,
                "nativeServiceVersion": "received response, when supplied by the service"}
    ident = sha(json_bytes(original))
    with domain.mutex:
        previous = domain.db.execute("SELECT body FROM os_requests WHERE id=?", (ident,)).fetchone()
        if previous:
            return load_json(previous[0])
        operation = {"id": ident, **original, "state": "PREPARED", "createdAt": time.time(),
                     "response": None, "attempt": None}
        operation["revision"] = sha(json_bytes(operation))
        with domain.db:
            domain._put("requests", operation)
        return operation

def _validate_response(operation, data):
    parsed = load_json(data)
    if not isinstance(parsed, dict):
        raise InputError("The native response must be a JSON object")
    if operation["kind"] == "match":
        responses = parsed.get("responses")
        if not isinstance(responses, dict) or set(responses) != set(operation["correlation"]):
            raise InputError("Native matching response correlation keys differ from the original request")
        candidates, summary = {}, {}
        for key, group in responses.items():
            if not isinstance(group, dict) or not isinstance(group.get("results"), list):
                raise InputError("A native query response is missing its results")
            total = group.get("total")
            if not isinstance(total, dict) or type(total.get("value")) is not int or total["value"] < len(group["results"]):
                raise InputError("Native matching total is inconsistent with returned results")
            values = []
            for result in group["results"]:
                if not isinstance(result, dict) or type(result.get("id")) is not str or type(result.get("match")) is not bool or type(result.get("score")) not in {float, int}:
                    raise InputError("Native candidate must retain id, score and match")
                if not isinstance(result.get("properties"), dict) or not isinstance(result.get("explanations"), dict):
                    raise InputError("Native candidate is missing original properties or explanations")
                values.append(result["id"])
            candidates[key] = values
            summary[key] = {"status": group.get("status", 200), "returned": len(values), "total": total,
                            "query": group.get("query")}
        return {"candidates": candidates, "queries": summary, "limit": parsed.get("limit")}
    if operation["kind"] == "entity":
        text(parsed.get("id"), "Returned native entity id", 512)
        if not isinstance(parsed.get("properties"), dict):
            raise InputError("The native entity refresh has no properties")
        return {"id": parsed["id"], "schema": parsed.get("schema"), "caption": parsed.get("caption"),
                "referents": parsed.get("referents", []), "lastChange": parsed.get("last_change")}
    if operation["kind"] == "statements":
        if not isinstance(parsed.get("results"), list) or not isinstance(parsed.get("total"), dict):
            raise InputError("The native statement response is missing its page and total")
        for row in parsed["results"]:
            if not isinstance(row, dict) or any(type(row.get(k)) is not str for k in
                ("id", "entity_id", "canonical_id", "prop", "prop_type", "schema", "value", "dataset", "first_seen", "last_seen")):
                raise InputError("A native statement lacks its original source/identity fields")
        return {"returned": len(parsed["results"]), "total": parsed["total"],
                "limit": parsed.get("limit"), "offset": parsed.get("offset", 0)}
    return {"keys": sorted(parsed), "datasets": len(parsed.get("datasets", []))}

def receive(domain, operation_id, data, *, status, headers=None, source_note, expected=None):
    """Attach an original remote-worker result or complete this process's dispatch."""
    bounded_int(status, 100, 599, "Native HTTP status")
    text(source_note, "Native response source", 4000)
    if not isinstance(data, bytes) or len(data) > 16 * 1024 * 1024:
        raise InputError("Use one complete native response within16MiB")
    headers = headers or {}
    if not isinstance(headers, dict) or any(type(k) is not str or type(v) is not str for k, v in headers.items()):
        raise InputError("Original response headers must be a text mapping")
    headers = {k: v for k, v in headers.items() if k.lower() in SAFE_HEADERS}
    with domain.mutex:
        operation = domain._one("requests", operation_id)
        response_sha = sha(data)
        if operation["response"] is not None:
            if operation["response"]["sha256"] == response_sha and operation["response"]["status"] == status:
                return operation
            raise InputError("The original operation already retains a different response")
        if expected != operation["revision"]:
            raise InputError("The original provider operation changed; refresh before receiving")
        original = domain.put_object(io.BytesIO(data), f"yente-{operation['kind']}-response.json",
                                     headers.get("Content-Type", headers.get("content-type", "application/json")),
                                     {"url": operation["url"], "status": status, "sourceNote": source_note})
        summary, invalid = None, None
        if 200 <= status < 300:
            try:
                summary = _validate_response(operation, data)
            except InputError as error:
                invalid = str(error)
        operation["response"] = {"object": original["id"], "sha256": response_sha, "bytes": len(data),
                                 "status": status, "headers": headers, "sourceNote": source_note,
                                 "summary": summary, "validationError": invalid, "receivedAt": time.time()}
        operation["state"] = "RECEIVED" if 200 <= status < 300 and invalid is None else "INVALID_RESPONSE" if invalid else "HTTP_ERROR"
        operation["previousRevision"] = operation["revision"]
        operation["revision"] = sha(json_bytes({k: v for k, v in operation.items() if k != "revision"}))
        with domain.db:
            domain._put("requests", operation, mutable=True)
        return operation

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def dispatch(domain, operation_id, *, expected):
    operation = domain._one("requests", operation_id)
    if operation["state"] in {"RECEIVED", "HTTP_ERROR", "INVALID_RESPONSE"}:
        return operation
    if operation["state"] != "PREPARED":
        raise InputError("This original request may already have left the process; receive its actual result instead of sending again")
    profile = domain._one("profiles", operation["profile"])
    headers = resolve_headers(profile)  # Resolve before the durable dispatch reservation.
    raw = domain.object_path(operation["request"]).read_bytes()
    if sha(raw) != operation["requestSha256"]:
        raise InputError("The prepared native request changed")
    if raw:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(operation["url"], data=raw if operation["method"] == "POST" else None,
                                     method=operation["method"], headers=headers)
    with domain.mutex, domain.db:
        current = domain._one("requests", operation_id)
        if current["state"] != "PREPARED" or current["revision"] != expected:
            raise InputError("The original request changed before dispatch")
        current["state"] = "DISPATCHING"
        current["attempt"] = {"startedAt": time.time(), "requestSha256": operation["requestSha256"]}
        current["previousRevision"] = current["revision"]
        current["revision"] = sha(json_bytes({k: v for k, v in current.items() if k != "revision"}))
        domain._put("requests", current, mutable=True)
    try:
        opener = urllib.request.build_opener(NoRedirect())
        try:
            response = opener.open(request, timeout=60)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            response_bytes = response.read(16 * 1024 * 1024 + 1)
            status = response.status
            response_headers = dict(response.headers)
        return receive(domain, operation_id, response_bytes, status=status, headers=response_headers,
                       source_note="Original configured yente HTTP response",
                       expected=current["revision"])
    except Exception as error:
        with domain.mutex, domain.db:
            latest = domain._one("requests", operation_id)
            if latest["state"] == "DISPATCHING":
                latest["state"] = "UNCERTAIN"
                latest["transportError"] = {"type": type(error).__name__, "at": time.time()}
                latest["previousRevision"] = latest["revision"]
                latest["revision"] = sha(json_bytes({k: v for k, v in latest.items() if k != "revision"}))
                domain._put("requests", latest, mutable=True)
        raise InputError("The original request outcome is uncertain; retain this operation and receive its actual remote result") from error

def recover_interrupted(domain):
    """Called only after the original Workspace lease has been acquired on reopen."""
    with domain.mutex, domain.db:
        recovered = []
        for row in domain.db.execute("SELECT body FROM os_requests").fetchall():
            operation = load_json(row[0])
            if operation["state"] != "DISPATCHING":
                continue
            operation["state"] = "UNCERTAIN"
            operation["transportError"] = {"type": "InterruptedOriginalDispatch", "at": time.time()}
            operation["previousRevision"] = operation["revision"]
            operation["revision"] = sha(json_bytes({k: v for k, v in operation.items() if k != "revision"}))
            domain._put("requests", operation, mutable=True); recovered.append(operation["id"])
        return recovered

def response_view(domain, operation_id):
    operation = domain._one("requests", operation_id)
    response = operation.get("response")
    if response is None:
        return {"operation": operation, "body": None}
    raw = domain.object_path(response["object"]).read_bytes()
    try:
        body = load_json(raw)
    except (InputError, ValueError, UnicodeError):
        return {"operation": operation, "body": None,
                "text": raw[:131072].decode("utf-8", errors="replace"),
                "textTruncated": len(raw) > 131072, "originalBytes": len(raw)}
    return {"operation": operation, "body": body}

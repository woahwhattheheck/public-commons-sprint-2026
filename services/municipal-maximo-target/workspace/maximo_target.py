"""Configured Maximo target capture in the original municipal Workspace.

Only GET requests are performed. All provider attempts, original response bytes,
complete target editions and original operation continuations live in the
Workspace database, and therefore in its ordinary editable backup.
"""
from __future__ import annotations
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urljoin, urlencode, parse_qsl
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler
import ssl

from .adapters import InvalidData, canonical
from .engine import Conflict, SHA

LIMIT = 20 * 1024 * 1024
PAGE_LIMIT = 8 * 1024 * 1024
CARRIER_LIMIT = 32 * 1024 * 1024
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\Z")
FIELD = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,99}\Z")
OUTPUT_FIELDS = ("id", "label", "status", "parent_id", "location_id", "geometry", "updated_at", "attributes")
SCHEMA = "municipal.maximo-target.v1"

def need(value, message):
    if not value:
        raise InvalidData(message)

def original(body):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, "Original JSON contains a repeated object key")
            result[key] = value
        return result
    try:
        return json.loads(body.decode("utf-8-sig"), parse_float=Decimal,
                          parse_constant=lambda value: need(False, "Non-finite original number"), object_pairs_hook=pairs)
    except (UnicodeError, ValueError, RecursionError) as error:
        raise InvalidData("Read complete original UTF-8 JSON") from error

def wire(value, maximum=PAGE_LIMIT):
    output, used = [], 0
    def add(text):
        nonlocal used
        used += len(text.encode("utf-8"))
        need(used <= maximum, "Complete JSON exceeds its original byte budget")
        output.append(text)
    def visit(item, depth=0):
        need(depth < 100, "Original JSON is nested too deeply")
        if item is None: add("null")
        elif item is True: add("true")
        elif item is False: add("false")
        elif isinstance(item, str): add(json.dumps(item, ensure_ascii=False))
        elif type(item) is int: add(str(item))
        elif type(item) is float:
            need(math.isfinite(item), "Non-finite generated number")
            add(json.dumps(item, allow_nan=False))
        elif isinstance(item, Decimal):
            need(item.is_finite(), "Non-finite original number")
            # Scientific notation preserves value without exponent-sized allocation.
            add(str(item))
        elif isinstance(item, list):
            add("[")
            for index, child in enumerate(item):
                if index: add(",")
                visit(child, depth+1)
            add("]")
        elif isinstance(item, dict):
            add("{")
            for index, key in enumerate(sorted(item)):
                need(isinstance(key, str), "Original object keys must be strings")
                if index: add(",")
                add(json.dumps(key, ensure_ascii=False)); add(":"); visit(item[key], depth+1)
            add("}")
        else: need(False, "Unsupported original JSON type")
    visit(value)
    return "".join(output).encode("utf-8")

def digest(value):
    return SHA(wire(value))

def key(parts):
    need(isinstance(parts, list) and parts, "Select complete native identity fields")
    for part in parts:
        need(isinstance(part, (str, int, Decimal)) and not isinstance(part, bool) and str(part) != "",
             "Each native identity component must be a present nonempty scalar")
    return wire(parts).decode()

def pointer(value, selector):
    need(isinstance(selector, str) and selector.startswith("/") and len(selector) <= 500, "Use an explicit JSON pointer")
    for token in selector[1:].split("/"):
        need(not re.search(r"~(?![01])", token), "Invalid JSON pointer escape")
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict) and token in value: value = value[token]
        else: return None
    return value

def endpoint(profile, suffix, params=None):
    return profile["api_base"] + "/" + suffix.lstrip("/") + ("?" + urlencode(params) if params else "")

def bound_url(profile, value, base=None, collection=False):
    need(isinstance(value, str) and 0 < len(value) <= 12000, "Provider link must be a bounded URL")
    parsed = urlsplit(urljoin(base or profile["api_base"] + "/", value))
    selected = urlsplit(profile["api_base"])
    need(parsed.scheme == "https" and parsed.netloc == selected.netloc and not parsed.username and not parsed.password
         and not parsed.fragment and parsed.path.startswith(selected.path.rstrip("/") + "/"),
         "Provider link leaves the configured Maximo API")
    need(not any(k.lower() in ("apikey", "access_token", "authorization", "password") for k, _ in parse_qsl(parsed.query)),
         "Keep credentials in the request header, outside provider links")
    if collection:
        need(parsed.path.rstrip("/") == selected.path.rstrip("/") + "/os/" + profile["object_structure"],
             "Paging link leaves the selected original object collection")
        need(not any(k.lower() in ("stableid", "stablepaging") for k, _ in parse_qsl(parsed.query)),
             "Use restartable ordinary paging; stable pages expire after delivery")
    return parsed.geturl()

def profile_read(value):
    need(isinstance(value, dict), "Use a complete Maximo profile object")
    allowed = {"schema", "id", "label", "api_base", "object_structure", "apikey_env", "where",
               "identity_fields", "order_by", "fields", "source_link", "crosswalk", "scope_equals",
               "page_size", "max_rows", "authorization_reference"}
    need(not set(value) - allowed, "Profile contains unrecognized fields")
    need(value.get("schema") == "municipal.maximo-profile.v1", "Unsupported Maximo profile")
    for name in ("id", "object_structure"):
        need(isinstance(value.get(name), str) and NAME.fullmatch(value[name]), "Use a short " + name)
    api = value.get("api_base")
    need(isinstance(api, str), "Select the actual HTTPS API base")
    u = urlsplit(api)
    need(u.scheme == "https" and u.hostname and not u.username and not u.password and not u.query and not u.fragment
         and u.path.rstrip("/").lower().endswith(("/api", "/oslc")) and "\\" not in api
         and "%" not in u.path and ".." not in u.path.split("/"), "Select the exact HTTPS /api or /oslc base")
    need(api == api.rstrip("/"), "API base must have no trailing slash")
    need(isinstance(value.get("apikey_env"), str) and re.fullmatch(r"[A-Z][A-Z0-9_]{2,99}", value["apikey_env"]),
         "Name the existing API-key environment variable; never include its secret")
    need(isinstance(value.get("authorization_reference"), str) and 1 <= len(value["authorization_reference"]) <= 1000,
         "Record the selected original tenant-read authorization reference")
    ids = value.get("identity_fields")
    need(isinstance(ids, list) and 1 <= len(ids) <= 8 and len(ids) == len(set(ids))
         and all(isinstance(x, str) and FIELD.fullmatch(x) for x in ids), "Select actual root native identity fields")
    order = value.get("order_by")
    need(isinstance(order, list) and order and all(isinstance(x, str) and re.fullmatch(r"[+-][A-Za-z_][A-Za-z0-9_]{0,99}", x) for x in order)
         and set(ids).issubset({x[1:] for x in order}), "Order by the selected persistent root identity fields")
    need(isinstance(value.get("where", ""), str) and len(value.get("where", "")) <= 8000, "Bound the selected source filter")
    fields = value.get("fields")
    need(isinstance(fields, dict) and not set(fields) - {"label", "status", "parent_id", "location_id", "updated_at"},
         "Select explicit scalar pointers for supported target fields")
    for selector in fields.values(): pointer({}, selector)
    link = value.get("source_link")
    if link is not None: pointer({}, link)
    crosswalk = value.get("crosswalk", [])
    need(isinstance(crosswalk, list) and len(crosswalk) <= 50000, "Use explicit native-key/source-ID crosswalk rows")
    seen_native, seen_source = set(), set()
    for row in crosswalk:
        need(isinstance(row, dict) and set(row) == {"native", "source_id", "reason"}, "Crosswalk needs native components, original source_id and reason")
        native = key(row["native"])
        need(len(row["native"]) == len(ids) and native not in seen_native, "Native key is duplicated in crosswalk")
        need(isinstance(row["source_id"], str) and 0 < len(row["source_id"]) <= 1000 and row["source_id"] not in seen_source,
             "Crosswalk must preserve one distinct original source row per target")
        need(isinstance(row["reason"], str) and row["reason"].strip(), "Explain each explicit identity binding")
        seen_native.add(native); seen_source.add(row["source_id"])
    scope = value.get("scope_equals", {})
    need(isinstance(scope, dict) and scope and len(scope) <= 10, "Declare the exact selected tenant org/site scope fields")
    for field, expected in scope.items():
        need(FIELD.fullmatch(field) and isinstance(expected, str) and expected, "Use exact nonempty org/site scope values")
    need(type(value.get("page_size", 200)) is int and 1 <= value.get("page_size", 200) <= 1000, "Page size must be 1–1000")
    need(type(value.get("max_rows", 10000)) is int and 1 <= value.get("max_rows", 10000) <= 50000, "Maximum rows must be 1–50000")
    return value

def initialize(workspace):
    with workspace.connection(write=True) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS maximo_profiles(id TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at REAL NOT NULL)""")
        db.execute("""CREATE TABLE IF NOT EXISTS maximo_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,binding TEXT NOT NULL,
          body TEXT NOT NULL,updated_at REAL NOT NULL)""")
        db.execute("""CREATE TABLE IF NOT EXISTS maximo_http(job_id TEXT NOT NULL,step TEXT NOT NULL,attempt INTEGER NOT NULL,
          request TEXT NOT NULL,response TEXT,body BLOB,PRIMARY KEY(job_id,step,attempt))""")
def save_profile(workspace, value):
    value = profile_read(value); initialize(workspace)
    with workspace.connection(write=True) as db:
        db.execute("INSERT INTO maximo_profiles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
                   (value["id"], canonical(value), time.time()))
    return {"id": value["id"], "sha256": SHA(canonical(value).encode())}
def profiles(workspace):
    initialize(workspace)
    with workspace.connection() as db:
        return [{"id": r["id"], "label": json.loads(r["body"]).get("label", r["id"]),
                 "api_base": json.loads(r["body"])["api_base"], "object_structure": json.loads(r["body"])["object_structure"]}
                for r in db.execute("SELECT * FROM maximo_profiles ORDER BY id")]
def load_profile(workspace, identity):
    with workspace.connection() as db:
        row = db.execute("SELECT body FROM maximo_profiles WHERE id=?", (identity,)).fetchone()
    need(row, "Configure the actual profile with the native CLI first")
    return profile_read(json.loads(row["body"]))
def load_job(workspace, operation):
    initialize(workspace)
    with workspace.connection() as db:
        row = db.execute("SELECT * FROM maximo_jobs WHERE id=?", (operation,)).fetchone()
    if not row: raise KeyError(operation)
    return {"id": row["id"], "project_id": row["project_id"], "binding": json.loads(row["binding"]), **json.loads(row["body"])}
def save_job(workspace, job):
    body = {k: v for k, v in job.items() if k not in ("id", "project_id", "binding")}
    with workspace.connection(write=True) as db:
        db.execute("UPDATE maximo_jobs SET body=?,updated_at=? WHERE id=?", (canonical(body), time.time(), job["id"]))
def summary(job):
    return {k: job.get(k) for k in ("id", "project_id", "state", "stage", "rows", "error", "not_before", "created_at", "completed_at", "received")}
def jobs(workspace, project_id):
    initialize(workspace)
    with workspace.connection() as db:
        ids = [row["id"] for row in db.execute("SELECT id FROM maximo_jobs WHERE project_id=? ORDER BY updated_at DESC", (project_id,))]
    return [summary(load_job(workspace, identity)) for identity in ids]
def prepare(workspace, project_id, actor, operation, revision, profile_id):
    initialize(workspace)
    need(isinstance(operation, str) and NAME.fullmatch(operation), "Use one short operation ID")
    need(isinstance(actor, str) and actor.strip(), "Name the receiving operator")
    profile = load_profile(workspace, profile_id)
    binding = {"project_id": project_id, "actor": actor, "revision": revision, "profile": profile}
    with workspace.connection(write=True) as db:
        old = db.execute("SELECT binding FROM maximo_jobs WHERE id=?", (operation,)).fetchone()
        if old:
            need(json.loads(old["binding"]) == binding, "Original operation belongs to a different request")
        else:
            current = workspace.project(project_id, db)
            if current["revision"] != revision: raise Conflict("Select the current project revision before target capture")
            job = {"state": "PENDING", "stage": "metadata", "rows": 0, "created_at": time.time(), "not_before": 0}
            db.execute("INSERT INTO maximo_jobs VALUES(?,?,?,?,?)", (operation, project_id, canonical(binding), canonical(job), time.time()))
    return load_job(workspace, operation)

@contextmanager
def operation_lock(workspace, identity):
    folder = workspace.root / "maximo-locks"
    folder.mkdir(mode=0o700, exist_ok=True)
    path = folder / (hashlib.sha256(identity.encode()).hexdigest() + ".lock")
    need(not path.is_symlink(), "Use the original regular operation lock")
    with path.open("a+b") as stream:
        os.chmod(path, 0o600)
        if os.name == "nt":
            import msvcrt
            stream.seek(0)
            if not stream.read(1): stream.write(b"0"); stream.flush()
            stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try: yield
        finally:
            if os.name == "nt":
                stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class Deferred(Exception):
    pass

def request(workspace, job, step, url):
    profile = job["binding"]["profile"]
    url = bound_url(profile, url)
    with workspace.connection() as db:
        rows = list(db.execute("SELECT * FROM maximo_http WHERE job_id=? AND step=? ORDER BY attempt", (job["id"], step)))
        total = db.execute("SELECT COALESCE(SUM(length(body)),0) FROM maximo_http WHERE job_id=?", (job["id"],)).fetchone()[0]
    for row in rows:
        if row["response"]:
            response = json.loads(row["response"])
            if response.get("complete") and response.get("status") == 200:
                need(json.loads(row["request"])["url"] == url, "Original source step URL changed")
                return original(row["body"]), dict(response, step=step, attempt=row["attempt"])
    deadline = job.get("not_before", 0)
    if time.time() < deadline:
        job.update(state="DEFERRED", error="The original provider retry time has not arrived")
        save_job(workspace, job)
        raise Deferred(job["error"])
    need(total < LIMIT, "Complete capture exceeds its retained source budget; narrow the selected profile")
    secret = os.environ.get(profile["apikey_env"], "")
    need(secret and len(secret) <= 16000 and not re.search(r"[\r\n]", secret), "Load the selected API key in its existing environment variable")
    attempt = len(rows) + 1
    need(attempt <= 20, "This original read has twenty retained attempts; review its actual provider outcomes")
    started = time.time()
    req = {"url": url, "method": "GET", "at": started, "headers": {"Accept": "application/json", "x-public-uri": profile["api_base"]}}
    with workspace.connection(write=True) as db:
        db.execute("INSERT INTO maximo_http(job_id,step,attempt,request) VALUES(?,?,?,?)", (job["id"], step, attempt, canonical(req)))
    headers, body, status, complete, problem = {}, b"", None, False, None
    headers_at = started
    response = None
    transport = False
    try:
        opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
        response = opener.open(Request(url, headers={**req["headers"], "apikey": secret}), timeout=40)
        status = response.status; headers = dict(response.headers); headers_at = time.time()
        body = response.read(min(PAGE_LIMIT, LIMIT-total)+1)
        need(len(body) <= min(PAGE_LIMIT, LIMIT-total), "Original response exceeds the complete capture budget")
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            need(content_length.isdigit(), "Provider Content-Length is invalid")
            if len(body) != int(content_length): raise http.client.IncompleteRead(body)
        complete = True
    except HTTPError as error:
        response = error; status = error.code; headers = dict(error.headers or {}); headers_at = time.time()
        try:
            body = error.read(min(PAGE_LIMIT, LIMIT-total)+1)
            need(len(body) <= min(PAGE_LIMIT, LIMIT-total), "Original error exceeds its retained budget")
            complete = True
        except (OSError, http.client.HTTPException) as transfer:
            transport = True; problem = type(transfer).__name__
            if isinstance(transfer, http.client.IncompleteRead): body = transfer.partial[:min(PAGE_LIMIT,LIMIT-total)]
        except InvalidData as invalid:
            problem = str(invalid)
    except (OSError, URLError, http.client.HTTPException) as error:
        transport = True; problem = type(error).__name__
        if isinstance(error, http.client.IncompleteRead): body = error.partial[:min(PAGE_LIMIT,LIMIT-total)]
    except InvalidData as error:
        problem = str(error)
    finally:
        if response is not None: response.close()
    meta = {"at": started, "headers_at": headers_at, "finished_at": time.time(), "status": status, "headers": headers, "complete": complete,
            "sha256": SHA(body), "bytes": len(body), "transport_error": problem}
    with workspace.connection(write=True) as db:
        db.execute("UPDATE maximo_http SET response=?,body=? WHERE job_id=? AND step=? AND attempt=?",
                   (canonical(meta), body, job["id"], step, attempt))
    retry = headers.get("Retry-After") or headers.get("retry-after")
    if retry:
        try:
            if re.fullmatch(r"\d+", retry.strip()):
                delay = int(retry)
            else:
                instant = parsedate_to_datetime(retry)
                if instant.tzinfo is None: raise ValueError("Retry-After date has no timezone")
                delay = instant.timestamp()-headers_at
            job["not_before"] = max(job.get("not_before", 0), headers_at+max(0, delay))
        except (ValueError, OverflowError, TypeError):
            job.update(state="REVIEW", error="Provider returned an unparseable Retry-After; complete original response is retained")
            save_job(workspace, job); raise InvalidData(job["error"])
    if transport or status in (408, 429, 500, 502, 503, 504):
        job["not_before"] = max(job.get("not_before", 0), time.time()+min(300, 2**min(attempt, 8)))
        job.update(state="DEFERRED", error=problem or "Original provider HTTP "+str(status))
        save_job(workspace, job); raise Deferred(job["error"])
    need(status == 200 and complete, problem or "Original Maximo read returned HTTP "+str(status))
    return original(body), dict(meta, step=step, attempt=attempt)

def collection(profile):
    selectors = set(profile["identity_fields"]) | set(profile["scope_equals"]) | {"_rowstamp"}
    for selector in list(profile["fields"].values()) + ([profile["source_link"]] if profile.get("source_link") else []):
        selectors.add(selector[1:].split("/")[0].replace("~1", "/").replace("~0", "~"))
    params = {"lean": "1", "_dropnulls": "0", "oslc.select": "*," + ",".join(sorted(selectors)), "oslc.pageSize": str(profile.get("page_size", 200)),
              "oslc.orderBy": ",".join(profile["order_by"])}
    if profile.get("where"): params["oslc.where"] = profile["where"]
    return endpoint(profile, "os/"+profile["object_structure"], params)

def next_page(profile, info, current_url):
    if "nextPage" not in info or info["nextPage"] is None: return None
    supplied = info["nextPage"]
    if isinstance(supplied, dict):
        need(isinstance(supplied.get("href"), str) and supplied["href"], "Original nextPage omits its URL")
        supplied = supplied["href"]
    need(isinstance(supplied, str) and supplied, "Original nextPage is not a complete URL")
    return bound_url(profile, supplied, current_url, collection=True)

def records_from_pages(profile, pages):
    values, ids, hrefs, totals = [], set(), set(), set()
    next_url = collection(profile)
    for number, page in enumerate(pages, 1):
        need(page["url"] == next_url, "Original collection chain is incomplete or reordered")
        data = original(base64.b64decode(page["body_base64"], validate=True))
        need(isinstance(data, dict) and isinstance(data.get("member"), list), "Expected lean Maximo member array")
        info = data.get("responseInfo", {})
        need(isinstance(info, dict), "Expected original responseInfo object")
        for raw in data["member"]:
            need(isinstance(raw, dict), "Original target record must be an object")
            ident = key([raw.get(field) for field in profile["identity_fields"]])
            need(ident not in ids, "Repeated native identity across pages; retain this edition and acquire a fresh capture")
            for field, expected in profile["scope_equals"].items():
                need(raw.get(field) == expected, "Original record is outside the selected org/site scope")
            href = bound_url(profile, raw.get("href", ""), page["url"])
            path = urlsplit(href).path
            need(path.startswith(urlsplit(collection(profile)).path + "/") and href not in hrefs,
                 "Original resource href is absent, repeated or outside the selected collection")
            ids.add(ident); hrefs.add(href); values.append(raw)
        need(len(values) <= profile.get("max_rows", 10000), "Original target population exceeds selected complete-row budget")
        count = info.get("totalCount")
        if count is not None:
            need(type(count) is int and count >= 0, "Invalid original totalCount")
            totals.add(count)
        next_url = next_page(profile, info, page["url"])
        if number < len(pages): need(next_url, "Rows follow a terminal original page")
    need(pages and next_url is None, "Read every original target page before receiving")
    need(len(totals) <= 1 and (not totals or next(iter(totals)) == len(values)), "Published target totalCount differs from retained population")
    return values

def schema_check(profile, schema):
    need(isinstance(schema, dict) and isinstance(schema.get("properties"), dict), "Read the actual root object schema")
    names = schema["properties"]
    needed = set(profile["identity_fields"]) | set(profile["scope_equals"])
    for selector in list(profile["fields"].values()) + ([profile["source_link"]] if profile.get("source_link") else []):
        needed.add(selector[1:].split("/")[0].replace("~1", "/").replace("~0", "~"))
    need(needed.issubset(names), "Configured fields are absent from the actual selected object schema")

def convert(profile, records):
    crosswalk = {key(row["native"]): row["source_id"] for row in profile.get("crosswalk", [])}
    rows, linked_ids, native_ids = [], set(), set()
    for raw in records:
        identity = key([raw.get(field) for field in profile["identity_fields"]]); native_ids.add(identity)
        linked = pointer(raw, profile["source_link"]) if profile.get("source_link") else None
        if linked is not None: need(isinstance(linked, str) and linked, "Source-link field must contain the exact nonempty original source ID")
        if identity in crosswalk:
            need(linked is None or linked == crosswalk[identity], "Original source-link field conflicts with explicit crosswalk")
            linked = crosswalk[identity]
        ident = linked or "maximo:"+profile["id"]+":"+identity
        need(ident not in linked_ids, "Several native rows resolve to one original source row")
        linked_ids.add(ident)
        row = {"id": ident, "geometry": None}
        for field, selector in profile["fields"].items():
            value = pointer(raw, selector)
            need(value is None or isinstance(value, (str, int, Decimal, bool)), "Mapped target field must be scalar")
            row[field] = "" if value is None else str(value) if not isinstance(value, str) else value
        row["attributes"] = {"maximo_native_key": identity, "maximo_resource_href": raw["href"],
                             "maximo_original_json": wire(raw).decode(), "maximo_source_linked": linked is not None}
        rows.append(row)
    need(set(crosswalk).issubset(native_ids), "Crosswalk references native rows outside this complete capture")
    return rows

def selected_pages(workspace, job, prefix):
    with workspace.connection() as db:
        rows = list(db.execute("SELECT * FROM maximo_http WHERE job_id=? AND step LIKE ? ORDER BY step,attempt", (job["id"], prefix+"%")))
    result = {}
    for row in rows:
        if row["response"]:
            response = json.loads(row["response"])
            if response.get("complete") and response.get("status") == 200:
                result[row["step"]] = {"step": row["step"], "url": json.loads(row["request"])["url"],
                    "meta": response, "body_base64": base64.b64encode(row["body"]).decode()}
    return [result[step] for step in sorted(result)]

def parse_capture(value):
    need(isinstance(value, dict) and value.get("schema") == SCHEMA, "Use a complete original Maximo target carrier")
    profile = profile_read(value["profile"])
    originals = value.get("originals")
    need(isinstance(originals, list) and originals, "Retain every original metadata and collection response")
    attempts = value.get("attempts", [])
    need(isinstance(attempts, list), "Retain the complete original attempt array")
    identities, total = set(), 0
    for item in originals + attempts:
        need(isinstance(item, dict) and isinstance(item.get("step"), str)
             and type(item.get("attempt")) is int and item["attempt"] > 0, "Invalid original attempt identity")
        identity = (item["step"], item["attempt"])
        need(identity not in identities, "Repeated original provider attempt")
        identities.add(identity)
        need(item["step"] in ("home", "schema", "schema_after") or re.fullmatch(r"[ab]-[0-9]{5}", item["step"]),
             "Unrecognized original source step")
        raw = base64.b64decode(item["body_base64"], validate=True); total += len(raw)
        need(len(raw) <= PAGE_LIMIT+1 and total <= LIMIT+1, "Original retained source exceeds its byte budget")
        meta = item.get("meta")
        need(isinstance(meta, dict), "Retain original response metadata")
        if meta.get("sha256") is not None:
            need(SHA(raw) == meta["sha256"] and len(raw) == meta.get("bytes"), "An original attempt body differs")
        else:
            need(not raw and meta.get("complete") is False and meta.get("status") is None,
                 "Only a recorded unfinished request can omit response identity")
        bound_url(profile, item["url"])
        request_meta = item.get("request")
        need(isinstance(request_meta, dict) and request_meta.get("url") == item["url"]
             and request_meta.get("method") == "GET", "Original request binding differs")
    steps = {}
    for item in originals:
        need(isinstance(item, dict) and item["step"] not in steps, "Repeated selected original source step")
        body = base64.b64decode(item["body_base64"], validate=True)
        need(SHA(body) == item["meta"]["sha256"] and len(body) == item["meta"]["bytes"], "Original provider bytes differ from manifest")
        need(item["meta"]["status"] == 200 and item["meta"]["complete"], "Selected source contains an incomplete provider result")
        bound_url(profile, item["url"])
        steps[item["step"]] = item
    for name in ("home", "schema", "schema_after"):
        need(name in steps, "Complete target schema/home source is missing")
    need(steps["home"]["url"] == profile["api_base"]+"/?lean=1", "Original API home binding differs")
    expected_schema = endpoint(profile, "jsonschemas/"+profile["object_structure"], {"lean":"1", "oslc.select":"*"})
    need(steps["schema"]["url"] == expected_schema and steps["schema_after"]["url"] == expected_schema,
         "Target schema does not belong to the selected object structure")
    schema = original(base64.b64decode(steps["schema"]["body_base64"]))
    after = original(base64.b64decode(steps["schema_after"]["body_base64"]))
    need(digest(schema) == digest(after), "Object schema changed during target capture")
    schema_check(profile, schema)
    first = [x for x in originals if x["step"].startswith("a-")]
    last = [x for x in originals if x["step"].startswith("b-")]
    before_rows, after_rows = records_from_pages(profile, first), records_from_pages(profile, last)
    fingerprints = lambda items: {key([r.get(f) for f in profile["identity_fields"]]): digest(r) for r in items}
    need(fingerprints(before_rows) == fingerprints(after_rows), "Target values changed between complete observations; retain and refresh")
    rows = convert(profile, before_rows)
    need(value.get("rows") == len(rows), "Carrier row count differs")
    return {"columns": list(OUTPUT_FIELDS), "rows": rows, "metadata": {
        "format": "maximo-target", "profile_id": profile["id"], "api_base": profile["api_base"],
        "object_structure": profile["object_structure"], "scope_equals": profile["scope_equals"],
        "identity_fields": profile["identity_fields"], "capture_operation": value["operation"],
        "observed_consistency": "Two complete ordinary-page observations with matching original records; not an atomic snapshot",
        "geometry": "Not inferred from target scalar fields; select the actual supported GIS export for geometry comparison",
        "source_files": len(originals), "source_linked": sum(row["attributes"]["maximo_source_linked"] for row in rows)}}

def carrier(workspace, job):
    with workspace.connection() as db:
        records = list(db.execute("SELECT * FROM maximo_http WHERE job_id=? ORDER BY step,attempt", (job["id"],)))
    originals, attempts, selected = [], [], {}
    for row in records:
        meta = json.loads(row["response"]) if row["response"] else {"complete": False, "status": None}
        item = {"step": row["step"], "attempt": row["attempt"], "url": json.loads(row["request"])["url"],
                "request": json.loads(row["request"]), "meta": meta, "body_base64": base64.b64encode(row["body"] or b"").decode()}
        attempts.append(item)
        if meta.get("complete") and meta.get("status") == 200: selected[row["step"]] = item
    order = ["home", "schema"] + sorted(k for k in selected if k.startswith("a-")) + sorted(k for k in selected if k.startswith("b-")) + ["schema_after"]
    originals = [selected[k] for k in order if k in selected]
    selected_attempts = {(x["step"], x["attempt"]) for x in originals}
    attempts = [x for x in attempts if (x["step"], x["attempt"]) not in selected_attempts]
    value = {"schema": SCHEMA, "operation": job["id"], "project_id": job["project_id"],
             "profile": job["binding"]["profile"], "rows": job.get("rows", 0),
             "originals": originals, "attempts": attempts, "created_at": job["created_at"]}
    body = canonical(value).encode()
    need(len(body) <= CARRIER_LIMIT, "Complete target carrier exceeds the native 32MiB input limit; narrow the selected scope")
    return body

def run(workspace, operation):
    with operation_lock(workspace, operation):
        job = load_job(workspace, operation)
        if job["state"] in ("READY", "RECEIVED"): return summary(job)
        if job["state"] == "REVIEW": raise InvalidData(job.get("error", "Review the original capture"))
        job.update(state="RUNNING", error=None); save_job(workspace, job)
        profile = job["binding"]["profile"]
        try:
            request(workspace, job, "home", profile["api_base"]+"/?lean=1")
            schema, _ = request(workspace, job, "schema", endpoint(profile, "jsonschemas/"+profile["object_structure"], {"lean":"1", "oslc.select":"*"}))
            schema_check(profile, schema)
            for phase in ("a", "b"):
                url, visited, number, count = collection(profile), set(), 0, 0
                while url:
                    need(url not in visited and number < 5000, "Repeated or excessive original page chain")
                    visited.add(url); number += 1
                    job["stage"] = phase+"-"+str(number); save_job(workspace, job)
                    data, _ = request(workspace, job, phase+"-"+str(number).zfill(5), url)
                    need(isinstance(data, dict) and isinstance(data.get("member"), list), "Expected lean Maximo member array")
                    count += len(data["member"])
                    need(count <= profile.get("max_rows", 10000), "Complete target population exceeds selected row budget")
                    info = data.get("responseInfo", {})
                    need(isinstance(info, dict), "Invalid original responseInfo")
                    url = next_page(profile, info, url)
                if phase == "a": job["rows"] = count
            request(workspace, job, "schema_after", endpoint(profile, "jsonschemas/"+profile["object_structure"], {"lean":"1", "oslc.select":"*"}))
            parse_capture(json.loads(carrier(workspace, job)))
            job.update(state="READY", stage="complete", completed_at=time.time(), not_before=0)
        except Deferred:
            pass
        except Exception as error:
            job.update(state="REVIEW", error=str(error))
        save_job(workspace, job)
        return summary(job)

def receive(workspace, project_id, operation, revision, actor, receive_operation):
    with operation_lock(workspace, operation):
        job = load_job(workspace, operation)
        need(job["project_id"] == project_id and job["state"] in ("READY", "RECEIVED"), "Receive the complete original capture in its project")
        body = carrier(workspace, job)
        # The original Workspace writer performs replay lookup before revision CAS.
        result = workspace.import_data(project_id, revision, actor, receive_operation, "target_assets",
                                       "Maximo-Complete-Target.json", "maximo-target", body)
        job.update(state="RECEIVED", received=result); save_job(workspace, job)
        return result

class Workers:
    def __init__(self, workspace):
        self.workspace = workspace
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="maximo-target")
        self.lock = threading.Lock(); self.futures = {}
    def start(self, operation):
        with self.lock:
            self.futures = {k:v for k,v in self.futures.items() if not v.done()}
            if operation in self.futures: return
            need(len(self.futures) < 2, "Two original target captures are active; continue them before starting another")
            self.futures[operation] = self.executor.submit(run, self.workspace, operation)
    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=False)


def export_jobs(workspace, project_id):
    initialize(workspace)
    output = {}
    with workspace.connection() as db:
        identities = [r["id"] for r in db.execute("SELECT id FROM maximo_jobs WHERE project_id=?", (project_id,))]
    for identity in identities:
        job = load_job(workspace, identity)
        name = SHA(identity.encode())[:24]
        output["maximo-captures/"+name+"/operation.json"] = canonical(job).encode()
        if job["state"] in ("READY", "RECEIVED"):
            output["maximo-captures/"+name+"/complete-target.json"] = carrier(workspace, job)
        else:
            with workspace.connection() as db:
                attempts = list(db.execute("SELECT * FROM maximo_http WHERE job_id=? ORDER BY step,attempt", (identity,)))
            original_attempts = [{**dict(row), "body": base64.b64encode(row["body"] or b"").decode()} for row in attempts]
            output["maximo-captures/"+name+"/original-attempts.json"] = canonical(original_attempts).encode()
    return output

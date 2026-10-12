"""Complete original Dataverse reads for the pinned native MsPlannerReader.

The Java reader remains unchanged. A private loopback transport supplies its
original JSON requests after following actual OData continuations. Original
provider bytes, continuation URLs and the exact combined reader bytes remain
immutable workspace objects. This module performs GET requests only.
"""
from __future__ import annotations

import base64
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
import re
import secrets
import threading
from urllib.parse import parse_qs, unquote, urljoin, urlsplit

from .target import TargetError, canonical, guid, utcnow

READER_COMMIT = "7ef9e72813d33378c55ec6ceb148cc831ed22033"
READER_BLOB = "91a32aeb9613e69485a4ac3771cb36401201dfd3"
MAP_ROW_BLOB = "f1ccddab4938195af7310569bcdf3cd209eb6cd0"
PROJECT_COLLECTIONS = {
    "tasks": "msdyn_msdyn_project_msdyn_projecttask_project",
    "dependencies": "msdyn_msdyn_project_msdyn_projecttaskdependency_Project",
    "assignments": "msdyn_msdyn_project_msdyn_resourceassignment_projectid",
}
RELATION_TYPES = ("FINISH_FINISH", "FINISH_START", "START_FINISH", "START_START")


class NativeReaderTransport:
    """One saved read capture, with a short-lived capability-bound local server."""

    def __init__(self, target, store, *, request_id, project_id, target_identity,
                 previous=None, persist=None, closing=None):
        self.target, self.store = target, store
        self.project_id = guid(project_id)
        self.persist = persist or (lambda value: None)
        self.closing = closing or threading.Event()
        self._stopping = threading.Event()
        self.binding = {
            "request_id": request_id, "project_id": self.project_id,
            "target_identity": target_identity, "provider_api_root": target.api_root,
            "native_reader": "org.mpxj.msplanner.MsPlannerReader",
            "reader_commit": READER_COMMIT, "reader_blob": READER_BLOB,
            "map_row_blob": MAP_ROW_BLOB, "reader_path_prefix": "/api/data/v9.2/",
            "max_response_bytes": target.profile.get("max_response_bytes", 64 * 1024 * 1024),
            "max_collection_rows": 250000, "max_capture_pages": 10000,
        }
        if previous is not None:
            if previous.get("schema") != "portfolio.msplanner-read-transport.v1" or previous.get("binding") != self.binding:
                raise TargetError("READER_CAPTURE_BINDING", "The retained read pages belong to another original capture.")
            self.state = copy.deepcopy(previous)
        else:
            self.state = {"schema": "portfolio.msplanner-read-transport.v1",
                          "binding": self.binding, "created_at": utcnow(),
                          "pages": {}, "requests": {}, "expanded_collections": {}, "complete": False}
        self.server = self.thread = None
        self.token = ""
        self.error = None
        self.origin = ""
        self._guard = threading.RLock()
        self._keep()

    def _keep(self):
        self.persist(self.state)

    def _check_reading(self):
        if self._stopping.is_set() or self.closing.is_set():
            raise TargetError("READER_PAUSED", "The original capture paused before its next native read.")

    def _url(self, value, context=None):
        if not isinstance(value, str) or not value or len(value) > 65536 or any(c in value for c in "\r\n\0\\"):
            raise TargetError("READER_CONTINUATION", "The original native continuation URL is invalid.")
        result = urljoin(context or self.target.api_root, value)
        parsed, root = urlsplit(result), urlsplit(self.target.api_root)
        decoded = unquote(parsed.path)
        if (parsed.scheme, parsed.netloc) != (root.scheme, root.netloc) or (
                parsed.username or parsed.password or parsed.fragment or
                not parsed.path.startswith(root.path) or not decoded.startswith(root.path) or
                any(part in (".", "..") for part in decoded.split("/")) or "\\" in decoded or "\0" in decoded):
            raise TargetError("READER_CONTINUATION_ORIGIN", "The native continuation left the selected environment API.")
        return result

    def _page(self, url):
        self._check_reading()
        saved = self.state["pages"].get(url)
        if saved is not None:
            receipt = self.store.read(saved["evidence_sha256"])
            raw = base64.b64decode(receipt["body_base64"], validate=True)
            if (receipt.get("url") != url or receipt.get("status") != 200 or receipt.get("complete") is not True or
                    len(raw) != receipt.get("bytes") or hashlib.sha256(raw).hexdigest() != receipt.get("sha256") or
                    saved["body_sha256"] != receipt["sha256"]):
                raise TargetError("READER_PAGE_CHANGED", "The retained complete native page has changed.")
            return json.loads(raw.decode("utf-8-sig"))
        if self.state.get("complete"):
            raise TargetError("READER_COMPLETE_SOURCE", "A completed capture cannot fetch another native page.")
        if len(self.state["pages"]) >= self.binding["max_capture_pages"]:
            raise TargetError("READER_PAGE_LIMIT", "The complete native capture exceeds its retained page limit.")
        data, receipt = self.target.request("GET", url)
        if receipt["status"] != 200 or not isinstance(data, dict):
            raise TargetError("READER_PAGE_SHAPE", "The original reader requires an HTTP 200 JSON object.",
                              evidence=receipt)
        ref = self.store.put(receipt)
        self.state["pages"][url] = {
            "url": url, "evidence_sha256": ref["sha256"], "body_sha256": receipt["sha256"],
            "bytes": receipt["bytes"], "retrieved_at": receipt["finished_at"],
        }
        self._keep()
        return data

    def _array(self, initial, next_link, context, chain, depth):
        values, current, continuation = [], initial, next_link
        while True:
            self._check_reading()
            for value in current:
                self._check_reading()
                values.append(self._expand(value, context, chain, depth + 1))
                if len(values) > self.binding["max_collection_rows"]:
                    raise TargetError("READER_COLLECTION_LIMIT",
                                      "The native collection exceeds the complete retained row limit.")
            if continuation is None:
                return values
            url = self._url(continuation, context)
            if url in chain:
                raise TargetError("READER_PAGE_CYCLE", "The native collection repeated an original continuation.")
            chain = (*chain, url)
            page = self._page(url)
            if not isinstance(page.get("value"), list):
                raise TargetError("READER_COLLECTION_PAGE", "The original continuation did not return a collection page.")
            current, continuation, context = page["value"], page.get("@odata.nextLink"), url

    def _expanded_array(self, initial, link, context, chain, depth, field):
        if link is None:
            return self._array(initial, None, context, chain, depth)
        url = self._url(link, context)
        if "$skiptoken" in parse_qs(urlsplit(url).query, keep_blank_values=True):
            mode = "continuation"
            complete = self._array(initial, link, context, chain, depth)
        else:
            # Dataverse single-level $expand emits a relationship URL containing
            # the same inline rows. Read that complete relationship, not a second
            # copy appended to the original rows. Its own top-level nextLink pages.
            mode = "complete_relationship"
            if url in chain:
                raise TargetError("READER_EXPANSION_CYCLE", "The original relationship URL repeats its ancestor.")
            page = self._page(url)
            if not isinstance(page.get("value"), list):
                raise TargetError("READER_RELATIONSHIP", "The original relationship did not return its collection.")
            complete = self._array(page["value"], page.get("@odata.nextLink"), url, (*chain, url), depth)
        key = hashlib.sha256(canonical({"context": context, "field": field, "url": url})).hexdigest()
        self.state.setdefault("expanded_collections", {})[key] = {
            "context_url": context, "field": field, "relationship_url": url, "mode": mode,
            "inline_sha256": self.store.put(initial)["sha256"], "inline_count": len(initial),
            "reader_collection_sha256": self.store.put(complete)["sha256"], "reader_count": len(complete),
        }
        self._keep()
        return complete

    def _expand(self, value, context, chain, depth=0):
        if depth > 64:
            raise TargetError("READER_STRUCTURE_LIMIT", "The complete native JSON nesting exceeds the reader limit.")
        if isinstance(value, list):
            return self._array(value, None, context, chain, depth)
        if not isinstance(value, dict):
            return value
        output = {}
        for key, item in value.items():
            if key == "@odata.nextLink" or key.endswith("@odata.nextLink"):
                field = "value" if key == "@odata.nextLink" else key[:-15]
                if not isinstance(value.get(field), list):
                    raise TargetError("READER_EXPANSION_PAGE", "A native continuation has no original collection.")
                if item is not None and (not isinstance(item, str) or not item):
                    raise TargetError("READER_CONTINUATION", "The native continuation is not a URL.")
                continue
            if isinstance(item, list):
                annotation = "@odata.nextLink" if key == "value" else key + "@odata.nextLink"
                if key == "value":
                    output[key] = self._array(item, value.get(annotation), context, chain, depth)
                else:
                    output[key] = self._expanded_array(item, value.get(annotation), context, chain, depth, key)
            else:
                output[key] = self._expand(item, context, chain, depth + 1)
        return output

    def _selection(self, relative):
        parsed = urlsplit(relative)
        query = parse_qs(parsed.query, keep_blank_values=True)
        if parsed.fragment or parsed.scheme or parsed.netloc:
            raise TargetError("READER_REQUEST", "The native reader must use its original local API path.")
        path = parsed.path
        if path == "msdyn_projects(" + self.project_id + ")" and query == {
                "$expand": [",".join(PROJECT_COLLECTIONS.values())]}:
            return "project"
        if path == "bookableresources" and not query:
            return "resources"
        if re.fullmatch(r"calendars\([0-9a-fA-F-]{36}\)", path) and query == {"$expand": ["calendar_calendar_rules"]}:
            guid(path[len("calendars("):-1])
            return "calendar"
        if path == "msdyn_projectbaselinedatas" and query == {
                "$filter": ["_msdyn_projectid_value eq " + self.project_id],
                "$expand": ["msdyn_msdyn_projectbaselinedata_msdyn_projectbaselinetaskdata"]}:
            return "baselines"
        raise TargetError("READER_REQUEST_SCOPE", "This request is outside the pinned original project reader.")

    def _response(self, relative):
        self._check_reading()
        kind = self._selection(relative)
        url = self._url(relative)
        saved = self.state["requests"].get(url)
        if saved is not None:
            if saved.get("kind") != kind:
                raise TargetError("READER_REQUEST_CHANGED", "The retained native reader request changed.")
            return self.store.read_bytes(saved["body_sha256"])
        page = self._page(url)
        complete = self._expand(page, url, (url,))
        if kind == "project":
            if guid(complete.get("msdyn_projectid")) != self.project_id:
                raise TargetError("READER_PROJECT_BINDING", "The actual native response names another project.")
            for field in PROJECT_COLLECTIONS.values():
                if not isinstance(complete.get(field), list):
                    raise TargetError("READER_PROJECT_EXPANSION", "The actual project response lacks a required expanded collection.")
        raw = canonical(complete)
        if len(raw) > self.binding["max_response_bytes"]:
            raise TargetError("READER_COMBINED_LIMIT",
                              "The complete combined reader response exceeds the selected max_response_bytes.")
        ref = self.store.put_bytes(raw)
        self.state["requests"][url] = {
            "url": url, "kind": kind, "body_sha256": ref["sha256"], "bytes": ref["bytes"],
            "combined_at": utcnow(),
        }
        self._keep()
        return raw

    def __enter__(self):
        owner = self
        self.token = secrets.token_urlsafe(32)

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_POST(self):
                self.send_error(405)

            def do_GET(self):
                self.close_connection = True
                if (self.headers.get("Host") != owner.origin.removeprefix("http://") or
                        not secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + owner.token)):
                    self.send_error(403)
                    return
                if not self.path.startswith("/api/data/v9.2/") or len(self.path) > 65536:
                    self.send_error(404)
                    return
                try:
                    with owner._guard:
                        raw = owner._response(self.path[len("/api/data/v9.2/"):])
                    self.send_response(200)
                except Exception as exc:
                    owner.error = exc
                    raw = canonical({"code": getattr(exc, "code", type(exc).__name__), "message": str(exc)})
                    self.send_response(502)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.end_headers()
                try:
                    self.wfile.write(raw)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass

        class Server(HTTPServer):
            def get_request(self):
                connection, address = super().get_request()
                connection.settimeout(30)
                return connection, address

        self.server = Server(("127.0.0.1", 0), Handler)
        self.origin = "http://127.0.0.1:" + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={"poll_interval": 0.1}, name="portfolio-native-reader", daemon=False)
        try:
            self.thread.start()
        except BaseException:
            self.server.server_close()
            self.server = None
            self.token = ""
            raise
        return self

    def __exit__(self, kind, value, traceback):
        # Java may have left while its HTTP thread is still paging. Retire that
        # local assembly before waiting; preserve any already received page.
        self._stopping.set()
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
        if self.thread is not None:
            self.thread.join()
        self.token = ""
        return False

    def raise_if_failed(self):
        if self.error is not None:
            raise self.error

    def finish(self):
        self.raise_if_failed()
        projects = [x for x in self.state["requests"].values() if x["kind"] == "project"]
        if len(projects) != 1:
            raise TargetError("READER_PROJECT_MISSING", "The original reader did not receive its selected complete project.")
        self.state["complete"] = True
        self.state.setdefault("reader_completed_at", utcnow())
        self._keep()
        return self.store.put(self.state)

    def project(self):
        candidates = [x for x in self.state["requests"].values() if x["kind"] == "project"]
        if len(candidates) != 1:
            raise TargetError("READER_PROJECT_MISSING", "Select the retained original project response.")
        receipt = candidates[0]
        return json.loads(self.store.read_bytes(receipt["body_sha256"]).decode("utf-8")), receipt


def _native_guid(row):
    value = row.get("guid")
    if value is None:
        value = row.get("fields", {}).get("GUID", {}).get("value")
    if value is None:
        return None
    try:
        return guid(value)
    except TargetError:
        return None


def native_capture_identity(plan, capture, transport, metadata):
    """Join actual provider identities to the exact native model from these pages."""
    project, project_receipt = transport.project()
    result, findings, joins = {}, [], []

    def unresolved(family, key, code, **evidence):
        findings.append({"family": family, "source_key": key, "code": code, **evidence})

    def by_guid(rows, field=None):
        index = {}
        for row in rows:
            raw = row.get(field) if field else _native_guid(row)
            if raw is None:
                continue
            try:
                identity = guid(raw)
            except TargetError:
                continue
            index.setdefault(identity, []).append(row)
        return index

    captured = capture["model"]
    indexes = {family: by_guid(captured.get(family, [])) for family in ("tasks", "resources", "assignments")}
    for family in ("tasks", "assignments"):
        selected = {}
        for original_key, native_id in plan["row_ids"].get(family, {}).items():
            candidates = indexes[family].get(guid(native_id), [])
            if len(candidates) == 1:
                selected[original_key] = candidates[0]["key"]
                joins.append({"family": family, "source_key": original_key,
                              "native_guid": guid(native_id), "reader_key": candidates[0]["key"]})
            else:
                unresolved(family, original_key, "CAPTURE_IDENTITY_UNRESOLVED",
                           native_guid=native_id, candidates=[r["key"] for r in candidates])
        result[family] = selected

    assignments = project[PROJECT_COLLECTIONS["assignments"]]
    team_field = metadata.lookup("msdyn_resourceassignment", "msdyn_projectteamid")
    assignment_key = metadata.entity("msdyn_resourceassignment")["key"]
    selected = {}
    for original_key, team_id in plan["row_ids"].get("resources", {}).items():
        links = []
        for row in assignments:
            try:
                if guid(row.get(team_field)) != guid(team_id):
                    continue
                links.append({"assignment_id": guid(row.get(assignment_key)),
                              "bookable_resource_id": guid(row.get("_msdyn_bookableresourceid_value"))})
            except TargetError:
                continue
        bookables = {row["bookable_resource_id"] for row in links}
        candidates = indexes["resources"].get(next(iter(bookables)), []) if len(bookables) == 1 else []
        if len(candidates) == 1:
            selected[original_key] = candidates[0]["key"]
            joins.append({"family": "resources", "source_key": original_key,
                          "project_team_id": guid(team_id), "native_assignment_links": links,
                          "bookable_resource_id": next(iter(bookables)), "reader_key": candidates[0]["key"]})
        else:
            unresolved("resources", original_key, "CAPTURE_RESOURCE_IDENTITY_UNRESOLVED",
                       project_team_id=team_id, native_assignment_links=links,
                       candidates=[r["key"] for r in candidates],
                       reader_behavior="MsPlannerReader materializes bookable resources used by project assignments.")
    result["resources"] = selected

    task_uids = {}
    for row in captured.get("tasks", []):
        if row.get("uid") is not None:
            task_uids.setdefault(str(row["uid"]), []).append(row)

    def task_guid(uid):
        rows = task_uids.get(str(uid), []) if uid is not None else []
        return _native_guid(rows[0]) if len(rows) == 1 else None

    dependency_key = metadata.entity("msdyn_projecttaskdependency")["key"]
    native_dependencies = by_guid(project[PROJECT_COLLECTIONS["dependencies"]], dependency_key)
    selected = {}
    for original_key, native_id in plan["row_ids"].get("dependencies", {}).items():
        rows = native_dependencies.get(guid(native_id), [])
        if len(rows) != 1:
            unresolved("dependencies", original_key, "CAPTURE_DEPENDENCY_RECORD_UNRESOLVED",
                       native_guid=native_id, native_record_count=len(rows))
            continue
        native_row = rows[0]
        try:
            predecessor = guid(native_row.get("_msdyn_predecessortask_value"))
            successor = guid(native_row.get("_msdyn_successortask_value"))
        except TargetError:
            unresolved("dependencies", original_key, "CAPTURE_DEPENDENCY_ENDPOINT_UNRESOLVED",
                       native_guid=native_id)
            continue
        raw_type = native_row.get("msdyn_projecttaskdependencylinktype")
        seconds = native_row.get("msdyn_projecttaskdependencylinklag")
        if seconds is None:
            seconds = 0  # Exact MapRow.getInt null behavior in the pinned reader.
        if (not isinstance(raw_type, int) or isinstance(raw_type, bool) or not 0 <= raw_type < len(RELATION_TYPES) or
                not isinstance(seconds, int) or isinstance(seconds, bool) or not -(2**31) <= seconds < 2**31):
            unresolved("dependencies", original_key, "CAPTURE_READER_DEPENDENCY_FIELDS",
                       native_guid=native_id,
                       reader_fields={key: native_row.get(key) for key in (
                           "msdyn_projecttaskdependencylinktype", "msdyn_projecttaskdependencylinklag")})
            continue
        relation = RELATION_TYPES[raw_type]
        hours = seconds / 3600.0
        candidates = []
        for row in captured.get("dependencies", []):
            lag = row.get("lag")
            try:
                number = float(lag["value"])
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            if (task_guid(row.get("predecessor_uid")) == predecessor and task_guid(row.get("successor_uid")) == successor and
                    row.get("type") == relation and lag.get("type") == "duration" and lag.get("units") == "HOURS" and
                    lag.get("elapsed") is False and math.isfinite(number) and number == hours):
                candidates.append(row)
        if len(candidates) == 1:
            selected[original_key] = candidates[0]["key"]
            joins.append({"family": "dependencies", "source_key": original_key, "native_guid": guid(native_id),
                          "predecessor_task_guid": predecessor, "successor_task_guid": successor,
                          "native_link_type": raw_type, "reader_relation_type": relation,
                          "native_lag_seconds": seconds, "reader_lag": candidates[0]["lag"],
                          "reader_key": candidates[0]["key"]})
        else:
            unresolved("dependencies", original_key, "CAPTURE_DEPENDENCY_IDENTITY_UNRESOLVED",
                       native_guid=native_id, predecessor_task_guid=predecessor,
                       successor_task_guid=successor, reader_relation_type=relation,
                       native_lag_seconds=seconds, candidates=[r["key"] for r in candidates])
    result["dependencies"] = selected

    # Two original source rows may resolve to one native resource/relation. Keep
    # that conflict explicit instead of acknowledging both through one reader row.
    for family, selected in result.items():
        inverse = {}
        for key, other in selected.items():
            inverse.setdefault(other, []).append(key)
        for other, keys in inverse.items():
            if len(keys) > 1:
                for key in keys:
                    selected.pop(key)
                    unresolved(family, key, "CAPTURE_IDENTITY_CONFLICT",
                               reader_key=other, competing_source_keys=keys)
    for join in joins:
        join["accepted"] = result.get(join["family"], {}).get(join["source_key"]) == join["reader_key"]
    evidence = {"schema": "portfolio.native-capture-identity.v1",
                "project_id": plan["project_id"], "capture_edition_id": capture["id"],
                "project_response_sha256": project_receipt["body_sha256"],
                "reader_commit": READER_COMMIT, "joins": joins,
                "identity_map": result, "findings": findings}
    return result, findings, evidence

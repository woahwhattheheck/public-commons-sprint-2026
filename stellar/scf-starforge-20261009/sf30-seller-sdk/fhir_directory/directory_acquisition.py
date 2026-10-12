"""MIT. Retained GET-only HSDS/HSD discovery, selected pages and same-request recovery."""
from __future__ import annotations
from contextlib import contextmanager
import gzip
import hashlib
import os
from pathlib import Path
import shutil
from urllib.parse import urlencode, urljoin, urlsplit, quote
import uuid
from directory_runtime import (InputError, ConflictError, ProviderError, Transport, private_directory,
    atomic_json, safe_read, now, retry_time, fhir, original_workspace)
from directory_source_schema import (OPERATION_SCHEMA, CAPTURE_SCHEMA, MAX_BYTES, MAX_RECORD, MAX_ROWS,
    MAX_PAGES, HSD_TYPES, HSDS_ENDPOINTS, typed, source_catalogue, import_value, standards,
    scope_url, sha, jbytes, json_value, lexical_json, integer)
from eltss_source import JSONReader
from eltss_acquisition import capability_summary, decoded_file

RETRY_CODES = {408, 429, 500, 502, 503, 504}


def _connection(raw, credentials):
    value = typed("connection", raw)
    if not value["label"].strip():
        raise InputError("Name the selected original directory endpoint")
    value["baseUrl"] = fhir.http_url(value["baseUrl"], "Directory service base", True)
    value.setdefault("authProfile", None)
    value.setdefault("publisher", "")
    value.setdefault("sourceUrl", "")
    value.setdefault("note", "")
    if value["authProfile"] is not None and value["authProfile"] not in {x["name"] for x in credentials.public()}:
        raise InputError("Select an existing private local authentication profile")
    return value


def _normal_request(raw, connection, discovery):
    value = typed("request", raw)
    value.setdefault("discoveryId", None)
    value.setdefault("nativeIds", [])
    value.setdefault("parameters", [])
    value.setdefault("url", None)
    value.setdefault("scope", "unknown")
    value.setdefault("note", "")
    value["limits"] = {k: value.get("limits", {}).get(k, default)
        for k, default in {"maxBytes": MAX_BYTES, "maxRecords": MAX_ROWS, "maxPages": MAX_PAGES}.items()}
    route, protocol, base = value["route"], connection["protocol"], connection["baseUrl"].rstrip("/")
    if not value["label"].strip():
        raise InputError("Label the exact reviewed directory request")
    initial, notes = [], []
    if route == "discovery":
        if value["nativeIds"] or value["parameters"] or value["url"]:
            raise InputError("Discovery uses only the selected endpoint's native metadata route")
        initial = [{"url": base + ("/" if protocol == "hsds" else "/metadata"), "kind": "discovery"}]
    elif route == "document":
        if not value["url"] or "document" not in value or value["nativeIds"] or value["parameters"]:
            raise InputError("Original document receiving needs one explicit URL and document interpretation")
        url = scope_url(base, value["url"])
        selected = value["document"]
        if protocol == "hsds" and selected["format"] not in {"hsds-json", "hsds-csv"} or \
                protocol == "fhir-hsd" and selected["format"] != "fhir-json":
            raise InputError("The selected document format does not match the reviewed connection protocol")
        if selected["format"].startswith("hsds") and selected.get("layout") != "tables" and not selected.get("table"):
            raise InputError("Original HSDS document requires its explicit canonical table")
        initial = [{"url": url, "kind": "document", "selection": selected}]
    else:
        if discovery is None or discovery["connectionId"] != connection["id"] or value["discoveryId"] != discovery["id"]:
            raise InputError("Select this exact endpoint's retained actual discovery before reviewing its native query")
        if value["url"]:
            raise InputError("Native list/read routes derive URLs from the reviewed endpoint and selected IDs")
        parameters = [(p["name"], p["value"]) for p in value["parameters"]]
        for name, _ in parameters:
            if not name or any(c in name for c in "\r\n\0"):
                raise InputError("Use exact nonempty original query parameter names")
        if route in {"hsds-list", "hsds-read"}:
            if protocol != "hsds" or value.get("table") not in HSDS_ENDPOINTS:
                raise InputError("Select an HSDS table with an original supported service endpoint")
            endpoint = base + "/" + HSDS_ENDPOINTS[value["table"]]
            if any(k in {"page", "per_page"} for k, _ in parameters):
                raise InputError("Keep reviewed HSDS page values in the explicit pagination object")
            if any(k == "format" and v != "json" for k, v in parameters):
                raise InputError("This native paginated receiver selects complete original JSON responses")
            if route == "hsds-list":
                if value["nativeIds"] or "pagination" not in value:
                    raise InputError("HSDS list requires explicit page numbering, page size and termination selection")
                pg = value["pagination"]
                pairs = [*parameters, ("page", str(pg["startPage"])), ("per_page", str(pg["perPage"]))]
                initial = [{"url": endpoint + "?" + urlencode(pairs), "kind": "hsds-page",
                    "page": pg["startPage"], "selection": {"format": "hsds-json", "layout": "page", "table": value["table"]}}]
            else:
                if not value["nativeIds"] or "pagination" in value:
                    raise InputError("HSDS reads need exact native IDs and no page selection")
                initial = [{"url": endpoint + "/" + quote(i, safe="") + ("?" + urlencode(parameters) if parameters else ""),
                    "kind": "hsds-entity", "nativeId": i,
                    "selection": {"format": "hsds-json", "layout": "entity", "table": value["table"]}}
                    for i in value["nativeIds"]]
        elif route in {"fhir-search", "fhir-read"}:
            if protocol != "fhir-hsd" or value.get("resourceType") not in HSD_TYPES:
                raise InputError("Choose an original HSD Organization, Location, HealthcareService or Endpoint route")
            rt = value["resourceType"]
            cap = discovery.get("capabilities", {}).get("resources", {}).get(rt, {})
            interaction = "search-type" if route == "fhir-search" else "read"
            if interaction not in cap.get("interactions", []):
                raise InputError("The retained actual CapabilityStatement does not advertise " + interaction + " for " + rt)
            if "pagination" in value:
                raise InputError("FHIR pagination follows exact returned next links, not HSDS page numbers")
            advertised = {p.get("name") for p in cap.get("searchParams", []) if isinstance(p, dict)}
            for name, val in parameters:
                if name.split(":", 1)[0] not in advertised and not name.startswith("_"):
                    notes.append({"parameter": name, "observation": "Not declared in the selected capability; retain the actual provider response"})
                if name.startswith("_include") and val not in cap.get("searchInclude", []) and "*" not in cap.get("searchInclude", []):
                    notes.append({"parameter": name, "value": val, "observation": "Selected include value is not advertised"})
            endpoint = base + "/" + rt
            if route == "fhir-search":
                if value["nativeIds"]:
                    raise InputError("FHIR search uses reviewed parameters; explicit IDs belong to native reads")
                initial = [{"url": endpoint + ("?" + urlencode(parameters) if parameters else ""),
                    "kind": "fhir-page", "selection": {"format": "fhir-json"}, "resourceType": rt}]
            else:
                if not value["nativeIds"] or parameters:
                    raise InputError("Native FHIR reads require explicit logical IDs and no search-only parameters")
                for ident in value["nativeIds"]:
                    if not __import__("re").fullmatch(r"[A-Za-z0-9.-]{1,64}", ident):
                        raise InputError("FHIR read IDs must be original logical IDs")
                initial = [{"url": endpoint + "/" + quote(ident, safe=""), "kind": "fhir-entity",
                    "nativeId": ident, "resourceType": rt, "selection": {"format": "fhir-json"}}
                    for ident in value["nativeIds"]]
        else:
            raise InputError("Unsupported original directory route")
    for selected in initial:
        scope_url(base, selected["url"])
    if len({x["url"] for x in initial}) != len(initial):
        raise InputError("A reviewed acquisition must not silently repeat identical native seed requests")
    if len(initial) > value["limits"]["maxPages"]:
        raise InputError("Explicit native seeds exceed the reviewed page limit")
    value["initialGets"], value["capabilityNotes"] = initial, notes
    value["connectionSnapshot"] = connection
    return value


def _native_int(value):
    if isinstance(value, fhir.Number):
        return int(value) if __import__("re").fullmatch(r"(?:0|[1-9][0-9]*)", value) else None
    return value if type(value) is int and value >= 0 else None


def _count_hsds(value, table):
    count = 1
    if not isinstance(value, dict):
        return count
    for key, spec in standards()["tables"][table]["schema"]["properties"].items():
        target = spec.get("$ref") or spec.get("items", {}).get("$ref")
        if not target or key not in value:
            continue
        table_name = target.rsplit("/", 1)[-1].removesuffix(".json")
        if table_name not in standards()["tables"]:
            continue
        values = value[key] if isinstance(value[key], list) else [value[key]]
        for item in values:
            if isinstance(item, dict):
                count += _count_hsds(item, table_name)
    return count


def _count_fhir(value):
    if not isinstance(value, dict) or not isinstance(value.get("resourceType"), str):
        raise InputError("Original FHIR response does not contain a resource")
    count = 1
    for item in value.get("contained", []):
        count += _count_fhir(item)
    if value["resourceType"] == "Bundle":
        for entry in value.get("entry", []):
            if isinstance(entry, dict) and isinstance(entry.get("resource"), dict):
                count += _count_fhir(entry["resource"])
    return count


def inspect_json(path, selection):
    """Read only one original record at a time; retain original header JSON and explicit pagination."""
    fmt, layout, table = selection["format"], selection.get("layout", "entity"), selection.get("table")
    header, identity, records, outer_rows = {}, None, 0, 0
    def count(value):
        return _count_hsds(value, table) if fmt == "hsds-json" else _count_fhir(value)
    with Path(path).open("rb") as stream:
        reader = JSONReader(stream, MAX_BYTES)
        if fmt == "hsds-json" and layout == "entity":
            _, value, _, _ = reader.raw(MAX_RECORD)
            records, outer_rows = count(value), 1
            identity = {"id": value.get("id")} if isinstance(value, dict) else None
        elif fmt == "hsds-json" and layout == "array":
            reader.take(91)
            reader.space()
            while reader.peek() != 93:
                _, value, _, _ = reader.raw(MAX_RECORD)
                records += count(value)
                outer_rows += 1
                reader.space()
                if reader.peek() != 93:
                    reader.take(44)
            reader.take(93)
        else:
            reader.take(123)
            reader.space()
            keys, saw_entries = set(), False
            while reader.peek() != 125:
                _, key, _, _ = reader.raw(65536)
                if type(key) is not str or key in keys:
                    raise InputError("Original directory response has duplicate or invalid JSON fields")
                keys.add(key)
                reader.take(58)
                selected_array = (fmt == "fhir-json" and key == "entry") or (fmt == "hsds-json" and layout == "page" and key == "contents")
                table_key = None
                if fmt == "hsds-json" and layout == "tables":
                    table_key = next((n for n, t in standards()["tables"].items()
                        if key in {n, t["schema"]["path"]}), None)
                    selected_array = table_key is not None
                if selected_array:
                    saw_entries = True
                    reader.take(91)
                    reader.space()
                    while reader.peek() != 93:
                        _, value, _, _ = reader.raw(MAX_RECORD)
                        outer_rows += 1
                        if fmt == "fhir-json":
                            if isinstance(value, dict) and isinstance(value.get("resource"), dict):
                                records += _count_fhir(value["resource"])
                        else:
                            records += _count_hsds(value, table_key or table)
                        reader.space()
                        if reader.peek() != 93:
                            reader.take(44)
                    reader.take(93)
                else:
                    _, value, _, _ = reader.raw(MAX_RECORD)
                    header[key] = value
                    if len(lexical_json(header).encode()) > MAX_RECORD:
                        raise InputError("Complete original directory metadata exceeds its supported budget")
                reader.space()
                if reader.peek() != 125:
                    reader.take(44)
            reader.take(125)
            if fmt == "fhir-json":
                if header.get("resourceType") == "Bundle":
                    if header.get("type") not in {"searchset", "collection", "history", "batch-response", "transaction-response", "document", "message", "batch", "transaction"}:
                        raise InputError("Retain a complete original FHIR Bundle type")
                elif saw_entries:
                    raise InputError("Original entry array requires a FHIR Bundle")
                else:
                    records, outer_rows = _count_fhir(header), 1
                    identity = {key: header.get(key) for key in ("resourceType", "id")}
            elif layout == "page" and not saw_entries:
                raise InputError("Selected HSDS page has no contents array")
        reader.space()
        if reader.peek() is not None:
            raise InputError("Additional bytes follow the original complete directory response")
    return {"records": records, "rows": outer_rows, "header": header, "identity": identity}


class DirectoryAcquisition:
    def directory_connection(self, raw):
        with self.mutex:
            value = _connection(raw, self.credentials)
            return self._directory_store("connections", {"schema": "stellar-forge.directory-connection.v1", **value})

    def directory_request(self, raw):
        with self.mutex:
            check = typed("request", raw)
            connection = self.directory_record("connections", check["connectionId"])
            discovery = self.directory_record("discoveries", check["discoveryId"]) if check.get("discoveryId") else None
            value = _normal_request(check, connection, discovery)
            return self._directory_store("requests", {"schema": "stellar-forge.directory-request.v1", **value})

    def _directory_operation_path(self, ident):
        return private_directory(self.root / "directory" / "operations" / fhir.operation_id(ident))

    def _directory_operation_save(self, op):
        op["updatedAt"] = now()
        # Native file-first journal survives death before the shared registry write.
        if len(jbytes(op)) > MAX_RECORD:
            raise InputError("Complete acquisition journal metadata exceeds 16 MiB; original HTTP files remain retained for explicit source receiving")
        atomic_json(self._directory_operation_path(op["id"]) / "operation.json", op)
        return self._directory_save("acquisitions", op)

    def directory_operation(self, ident):
        with self.mutex:
            ident = fhir.operation_id(ident)
            directory = self._directory_operation_path(ident)
            row = self.directory_record("acquisitions", ident, required=False)
            path = directory / "operation.json"
            if path.exists():
                value = json_value(safe_read(path, MAX_RECORD))
                if value.get("schema") != OPERATION_SCHEMA or value.get("id") != ident or value.get("workspaceId") != self.workspace_id:
                    raise InputError("Retained directory operation ownership changed")
                if row and row.get("requestId") != value.get("requestId"):
                    raise ConflictError("Original directory operation was rebound to a different request")
                row = value
                self._directory_save("acquisitions", row)
            if row is None:
                raise InputError("Unknown retained directory acquisition operation")
            if row.get("workspaceId") != self.workspace_id:
                raise InputError("This directory acquisition belongs to another workspace UUID")
            for item in row.get("recoveryFiles", []):
                dest = directory / item["name"]
                # Names are original controlled transport stems, never arbitrary extraction paths.
                if "/" in item["name"] or "\\" in item["name"] or item["name"] in {"", ".", "..", "operation.json"}:
                    raise InputError("Invalid original directory recovery member")
                source = self._file_path(item["file"])
                if dest.exists():
                    if original_workspace.file_digest(dest, MAX_BYTES) != item["file"]["sha256"]:
                        raise InputError("Original directory recovery file changed")
                else:
                    with source.open("rb") as inp, os.fdopen(os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as out:
                        shutil.copyfileobj(inp, out, 65536)
                        out.flush()
                        os.fsync(out.fileno())
            return row

    def directory_acquire(self, request_id, operation_id):
        with self.mutex:
            request = self.directory_record("requests", fhir.identity(request_id))
            ident = fhir.operation_id(operation_id)
            existing = self.directory_record("acquisitions", ident, required=False)
            if existing or (self._directory_operation_path(ident) / "operation.json").exists():
                op = self.directory_operation(ident)
                if op["requestId"] != request_id:
                    raise ConflictError("Use the original directory operation ID only for its exact retained request")
                return op
            return self._directory_operation_save({"schema": OPERATION_SCHEMA, "id": ident, "operationId": ident,
                "workspaceId": self.workspace_id, "requestId": request_id, "connectionId": request["connectionId"],
                "requestSha256": sha(jbytes(request)), "state": "ready", "phase": "reserved-original-get",
                "queue": list(request["initialGets"]), "seenUrls": [x["url"] for x in request["initialGets"]],
                "attempts": [], "pages": [], "recoveryFiles": [], "activeStep": None,
                "receivedBytes": 0, "decodedBytes": 0, "receivedRecords": 0, "receivedRows": 0,
                "pageCount": 0, "notBefore": None, "sourceId": None, "discoveryId": None,
                "observations": [], "error": None, "createdAt": now()})

    def directory_discover(self, connection_id, operation_id):
        connection = self.directory_record("connections", fhir.identity(connection_id))
        request = self.directory_request({"label": connection["label"] + " — original discovery",
            "connectionId": connection_id, "route": "discovery", "origin": "operator_source"})
        op = self.directory_acquire(request["id"], operation_id)
        return self.directory_advance(op["id"])

    def directory_pause(self, ident):
        with self.mutex:
            op = self.directory_operation(ident)
            if op["state"] != "complete":
                op["state"], op["phase"] = "paused", "paused-locally"
                return self._directory_operation_save(op)
            return op

    def directory_resume(self, ident):
        with self.mutex:
            op = self.directory_operation(ident)
            if op["state"] == "complete":
                return op
            if op.get("error") and not op["error"].get("retryable", False):
                # Review changes produce a new immutable request, not an unnoticed mutation of this one.
                raise InputError("This original request needs an explicit revised selection; its complete retained bytes remain available")
            op["state"], op["phase"], op["error"] = "ready", "continue-original-get", None
            op["activeStep"] = None if (op.get("activeStep") or {}).get("failed") else op.get("activeStep")
            if op.get("notBefore") and fhir.epoch(op["notBefore"]) > fhir.epoch(now()):
                op["state"] = "waiting"
            return self._directory_operation_save(op)

    def _directory_review(self, op, message, retryable=False):
        op["state"], op["phase"] = "needs-review", "retained-original-response"
        op["error"] = {"message": str(message), "retryable": retryable}
        if op.get("activeStep"):
            op["activeStep"]["failed"] = True
        return self._directory_operation_save(op)

    def _directory_retain_recovery(self, op):
        directory = self._directory_operation_path(op["id"])
        files = []
        total = 0
        for path in sorted(directory.iterdir()):
            if path.name == "operation.json" or not path.is_file() or path.is_symlink():
                continue
            if path.suffix not in {".wire", ".json"}:
                continue
            size = original_workspace.regular(path, MAX_BYTES).st_size
            total += size
            if total > 2 * MAX_BYTES + MAX_RECORD:
                raise InputError("Complete directory operation recovery files exceed the supported combined budget")
            files.append({"name": path.name, "file": self._retain_file(path, "directory-original-http-recovery")})
        op["recoveryFiles"] = files
        return op

    def directory_sync_sources(self):
        with self.mutex:
            directory = private_directory(self.root / "directory" / "operations")
            retained = []
            for child in directory.iterdir():
                if child.is_dir() and not child.is_symlink() and (child / "operation.json").exists():
                    op = self.directory_operation(child.name)
                    self._directory_retain_recovery(op)
                    retained.append(self._directory_operation_save(op))
            return retained

    def _directory_queue(self, op, request, item):
        if item["url"] in op["seenUrls"]:
            return self._directory_review(op, "The original provider pagination repeats an already selected URL")
        if len(op["seenUrls"]) >= request["limits"]["maxPages"]:
            return self._directory_review(op, "The selected directory query reaches its reviewed page limit")
        op["seenUrls"].append(item["url"])
        op["queue"].append(item)
        return None

    def _directory_page(self, op, request, current, inspection, actual_url):
        header, rows = inspection["header"], inspection["rows"]
        if current["kind"] in {"hsds-entity", "fhir-entity"}:
            identity = inspection.get("identity") or {}
            if type(identity.get("id")) is not str or identity["id"] != current["nativeId"]:
                return self._directory_review(op, "The original single-record response ID differs from the exact requested native ID")
            if current["kind"] == "fhir-entity" and (
                    type(identity.get("resourceType")) is not str or identity["resourceType"] != current["resourceType"]):
                return self._directory_review(op, "The original FHIR read response resourceType differs from the exact requested resource type")
        elif current["kind"] == "hsds-page":
            if type(header.get("empty")) is not bool:
                return self._directory_review(op, "The original HSDS Page must include its native empty boolean")
            if header["empty"] != (rows == 0):
                return self._directory_review(op, "Original HSDS empty flag and complete contents disagree")
            page_number = _native_int(header.get("page_number"))
            if page_number is not None and page_number != current["page"]:
                return self._directory_review(op, "Provider page_number differs from the exact requested original page")
            if header.get("first_page") is True:
                if op.get("numberingBase") is not None and op["numberingBase"] != current["page"]:
                    return self._directory_review(op, "Original pagination declared two different first pages")
                op["numberingBase"] = current["page"]
            total_pages = _native_int(header.get("total_pages"))
            end_by_count = op.get("numberingBase") is not None and total_pages is not None and total_pages > 0 and \
                page_number == op["numberingBase"] + total_pages - 1
            terminate = header.get("last_page") is True or end_by_count
            if request["pagination"]["termination"] == "empty-page" and header["empty"]:
                terminate = True
            if not terminate and rows == 0:
                return self._directory_review(op, "Empty original page does not satisfy the reviewed declared termination rule")
            if not terminate and request["pagination"]["termination"] == "declared" and \
                    type(header.get("last_page")) is not bool and not (
                    op.get("numberingBase") is not None and total_pages is not None):
                return self._directory_review(op, "The original page lacks a declared stopping signal; review a different explicit pagination request")
            if not terminate:
                n = current["page"] + 1
                base = request["connectionSnapshot"]["baseUrl"].rstrip("/") + "/" + HSDS_ENDPOINTS[request["table"]]
                pairs = [(p["name"], p["value"]) for p in request["parameters"]]
                pairs += [("page", str(n)), ("per_page", str(request["pagination"]["perPage"]))]
                return self._directory_queue(op, request, {**current, "page": n, "url": base + "?" + urlencode(pairs)})
        elif current["kind"] == "fhir-page":
            if header.get("resourceType") != "Bundle" or header.get("type") != "searchset":
                return self._directory_review(op, "The actual FHIR search response is not a searchset Bundle")
            links = header.get("link", [])
            if not isinstance(links, list):
                return self._directory_review(op, "Original FHIR Bundle.link is not an array")
            next_links = [x.get("url") for x in links if isinstance(x, dict) and x.get("relation") == "next"]
            if len(next_links) > 1 or any(type(x) is not str or not x for x in next_links):
                return self._directory_review(op, "The original search has an ambiguous or incomplete next-link selection")
            if next_links:
                url = scope_url(request["connectionSnapshot"]["baseUrl"], urljoin(actual_url, next_links[0]))
                return self._directory_queue(op, request, {**current, "url": url})
        return None

    def directory_advance(self, ident):
        with self.mutex:
            op = self.directory_operation(ident)
            if op["state"] in {"complete", "paused", "needs-review"}:
                return op
            if op.get("notBefore") and fhir.epoch(op["notBefore"]) > fhir.epoch(now()):
                op["state"] = "waiting"
                return self._directory_operation_save(op)
            request = self.directory_record("requests", op["requestId"])
            if sha(jbytes(request)) != op["requestSha256"]:
                raise ConflictError("Original directory request bytes changed")
            if not op["queue"]:
                return self._directory_finalize(op, request)
            current = op["queue"][0]
            if op.get("activeStep") is None:
                op["activeStep"] = {"id": "get-" + str(len(op["attempts"]) + 1).zfill(6), "request": current}
            step = op["activeStep"]
            if step["request"] != current:
                raise ConflictError("Active original directory HTTP step differs from the retained queue")
            op["state"], op["phase"], op["error"] = "receiving", "receive-original-get", None
            self._directory_operation_save(op)
            directory = self._directory_operation_path(op["id"])
            existing_attempt = next((a for a in op["attempts"] if a["id"] == step["id"]), None)
            remaining = request["limits"]["maxBytes"] - op["receivedBytes"] + (
                existing_attempt["receipt"].get("bytes", 0) if existing_attempt else 0)
            if remaining <= 0:
                return self._directory_review(op, "Complete received wire bytes exhaust the reviewed query budget")
            accept = "application/fhir+json, application/json" if request["connectionSnapshot"]["protocol"] == "fhir-hsd" else "application/json"
            if current.get("selection", {}).get("format") == "hsds-csv":
                accept = "text/csv"
            try:
                receipt = Transport(self.credentials).receive(directory, step["id"], "GET", current["url"],
                    {"Accept": accept, "Accept-Encoding": "identity"}, None, request["connectionSnapshot"], limit=remaining)
            except (InputError, ProviderError, OSError) as error:
                self._directory_retain_recovery(op)
                return self._directory_review(op, str(error), retryable=isinstance(error, (ProviderError, OSError)))
            attempt = next((a for a in op["attempts"] if a["id"] == step["id"]), None)
            if attempt is None:
                attempt = {"id": step["id"], "request": current, "receipt": receipt,
                    "wireFile": self._retain_file(directory / receipt["body"], "directory-original-http-body") if receipt.get("body") else None}
                op["attempts"].append(attempt)
                op["receivedBytes"] += receipt.get("bytes", 0)
            self._directory_retain_recovery(op)
            self._directory_operation_save(op)
            if not receipt.get("complete"):
                return self._directory_review(op, receipt.get("transportError", "Original HTTP response was interrupted"), True)
            if receipt.get("status") != 200:
                op["notBefore"] = retry_time(receipt.get("headers", {}).get("retry-after")) if receipt.get("status") in RETRY_CODES else None
                if receipt.get("status") in RETRY_CODES:
                    op["activeStep"] = None
                    op["state"], op["phase"] = "waiting" if op["notBefore"] else "paused", "retained-retryable-response"
                    op["error"] = {"message": "Original provider returned HTTP " + str(receipt.get("status")), "retryable": True}
                    return self._directory_operation_save(op)
                return self._directory_review(op, "Original provider returned HTTP " + str(receipt.get("status")))
            try:
                actual = scope_url(request["connectionSnapshot"]["baseUrl"], receipt.get("actualUrl", current["url"]))
                decoded = decoded_file(directory, receipt, request["limits"]["maxBytes"] - op["decodedBytes"])
                decoded_desc = self._retain_file(decoded, "directory-decoded-original")
                if op["decodedBytes"] + decoded_desc["bytes"] > request["limits"]["maxBytes"]:
                    return self._directory_review(op, "Complete decoded response bytes exceed the reviewed source budget")
                if current["kind"] == "discovery":
                    if decoded_desc["bytes"] > MAX_RECORD:
                        return self._directory_review(op, "Complete discovery exceeds 16 MiB")
                    original = json_value(safe_read(decoded, MAX_RECORD))
                    if request["connectionSnapshot"]["protocol"] == "hsds":
                        if not isinstance(original, dict) or not isinstance(original.get("version"), str):
                            return self._directory_review(op, "The actual HSDS root lacks its original version")
                        details = {"declaredVersion": original["version"], "profile": original.get("profile"),
                            "openapiUrl": original.get("openapi_url"), "capabilities": None}
                    else:
                        details = {"declaredVersion": original.get("fhirVersion"), "capabilities": capability_summary(original)}
                    discovery = self._directory_store("discoveries", {"schema": "stellar-forge.directory-discovery.v1",
                        "connectionId": op["connectionId"], "operationId": op["id"], "requestId": op["requestId"],
                        "url": actual, "response": receipt, "wireFile": attempt["wireFile"], "decodedFile": decoded_desc, **details})
                    op["discoveryId"] = discovery["id"]
                    op["decodedBytes"] += decoded_desc["bytes"]
                else:
                    if current["selection"]["format"] == "hsds-csv":
                        # Reuse the exact streaming source parser; no alternate CSV interpretation.
                        inspection = self._directory_inspect_csv(decoded, current["selection"])
                    else:
                        inspection = inspect_json(decoded, current["selection"])
                    if op["receivedRecords"] + inspection["records"] > request["limits"]["maxRecords"]:
                        return self._directory_review(op, "Complete selected records exceed the reviewed source-record budget")
                    previous_same = any(p["decodedFile"]["sha256"] == decoded_desc["sha256"] for p in op["pages"])
                    if current["kind"] in {"hsds-page", "fhir-page"} and previous_same and inspection["rows"]:
                        return self._directory_review(op, "Original pagination repeated an identical nonempty response; completeness remains unproven")
                    header_text = lexical_json(inspection["header"])
                    header_bytes = header_text.encode("utf-8")
                    with self.scratch() as scratch:
                        header_path = Path(scratch) / "original-header.json"
                        with os.fdopen(os.open(header_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                            stream.write(header_bytes + b"\n")
                            stream.flush()
                            os.fsync(stream.fileno())
                        header_file = self._retain_file(header_path, "directory-complete-original-header-values")
                    op["pages"].append({"ordinal": len(op["pages"]) + 1, "url": actual, "requestUrl": current["url"],
                        "selection": current["selection"], "wireFile": attempt["wireFile"], "decodedFile": decoded_desc,
                        "receiptId": step["id"], "records": inspection["records"], "rows": inspection["rows"],
                        "headerJson": header_text if len(header_bytes) <= 8192 else None,
                        "headerBytes": len(header_bytes), "headerSha256": sha(header_bytes), "headerFile": header_file})
                    op["receivedRecords"] += inspection["records"]
                    op["receivedRows"] += inspection["rows"]
                    op["decodedBytes"] += decoded_desc["bytes"]
                    op["pageCount"] += 1
                    op["queue"].pop(0)
                    op["activeStep"], op["notBefore"] = None, None
                    review = self._directory_page(op, request, current, inspection, actual)
                    if review:
                        self._directory_retain_recovery(op)
                        return self._directory_operation_save(review)
                    self._directory_retain_recovery(op)
                    if not op["queue"]:
                        return self._directory_finalize(op, request)
                    op["state"], op["phase"] = "ready", "next-original-get"
                    return self._directory_operation_save(op)
            except (InputError, OSError, ValueError) as error:
                self._directory_retain_recovery(op)
                return self._directory_review(op, str(error), retryable=isinstance(error, OSError))
            op["queue"].pop(0)
            op["activeStep"], op["notBefore"] = None, None
            self._directory_retain_recovery(op)
            return self._directory_finalize(op, request)

    def _directory_finalize(self, op, request):
        if request["route"] != "discovery":
            if not op["pages"]:
                return self._directory_review(op, "No complete original directory pages are available")
            original = self._directory_capture_source(op, request, completed=True)
            op["sourceId"] = original["id"]
        op["state"], op["phase"], op["error"], op["notBefore"] = "complete", "complete-original-receiving", None, None
        return self._directory_operation_save(op)

    def directory_capture_source(self, ident):
        with self.mutex:
            op = self.directory_operation(ident)
            request = self.directory_record("requests", op["requestId"])
            if not op["pages"]:
                raise InputError("No complete original directory pages are available to freeze")
            return self._directory_capture_source(op, request, completed=op["state"] == "complete")

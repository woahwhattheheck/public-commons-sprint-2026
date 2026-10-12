#!/usr/bin/env python3
"""Retain original Intrinio SDK responses for the existing Python workspace.

The collector owns only raw acquisition files and a resumable capture ledger.
The original PythonWorkspace owns editions, review state and portable history.
No SDK model serialization, alternate HTTP client or provider account creation.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import decimal
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import urllib.parse
import uuid
import zlib

SDK_COMMIT = "b5918a9123f0ccbe624f559e8ab5a6c8e73c01c6"
SDK_VERSION = "7.2.0"
API_ORIGIN = "https://api-v2.intrinio.com"
SOURCE_LIMIT = 8 * 1024 * 1024
REVISION_LIMIT = 32 * 1024 * 1024
REGISTRY = json.loads(r'''[{"id":"company","method":"GET","apiClass":"CompanyApi","apiMethod":"get_company","route":"/companies/{identifier}","pathParams":["identifier"],"queryParams":[],"array":null,"parent":null,"pagination":"singleton"},{"id":"company-filings","method":"GET","apiClass":"CompanyApi","apiMethod":"get_company_filings","route":"/companies/{identifier}/filings","pathParams":["identifier"],"queryParams":["report_type","start_date","end_date","page_size","next_page"],"array":"filings","parent":"company","pagination":"next_page"},{"id":"company-fundamentals","method":"GET","apiClass":"CompanyApi","apiMethod":"get_company_fundamentals","route":"/companies/{identifier}/fundamentals","pathParams":["identifier"],"queryParams":["filed_after","filed_before","reported_only","fiscal_year","statement_code","type","fundamental_type","start_date","end_date","updated_after","latest_only","updated_before","page_size","next_page"],"array":"fundamentals","parent":"company","pagination":"next_page"},{"id":"filing","method":"GET","apiClass":"FilingApi","apiMethod":"get_filing_by_id","route":"/filings/{id}","pathParams":["id"],"queryParams":[],"array":null,"parent":null,"pagination":"singleton"},{"id":"filing-fundamentals","method":"GET","apiClass":"FilingApi","apiMethod":"get_filing_fundamentals","route":"/filings/{identifier}/fundamentals","pathParams":["identifier"],"queryParams":["statement_code","type","fiscal_year","fiscal_period","start_date","end_date","next_page"],"array":"fundamentals","parent":"filing","pagination":"next_page"},{"id":"fundamental","method":"GET","apiClass":"FundamentalsApi","apiMethod":"get_fundamental_by_id","route":"/fundamentals/{id}","pathParams":["id"],"queryParams":[],"array":null,"parent":null,"pagination":"singleton"},{"id":"fundamental-lookup","method":"GET","apiClass":"FundamentalsApi","apiMethod":"lookup_fundamental","route":"/fundamentals/lookup/{identifier}/{statement_code}/{fiscal_year}/{fiscal_period}","pathParams":["identifier","statement_code","fiscal_year","fiscal_period"],"queryParams":[],"array":null,"parent":null,"pagination":"singleton"},{"id":"reported-financials","method":"GET","apiClass":"FundamentalsApi","apiMethod":"get_fundamental_reported_financials","route":"/fundamentals/{id}/reported_financials","pathParams":["id"],"queryParams":[],"array":"reported_financials","parent":"fundamental","pagination":"next_page-model-generated-method-has-no-cursor"},{"id":"standardized-financials","method":"GET","apiClass":"FundamentalsApi","apiMethod":"get_fundamental_standardized_financials","route":"/fundamentals/{id}/standardized_financials","pathParams":["id"],"queryParams":[],"array":"standardized_financials","parent":"fundamental","pagination":"next_page-model-generated-method-has-no-cursor"},{"id":"standardized-dimensions","method":"GET","apiClass":"FundamentalsApi","apiMethod":"get_fundamental_standardized_financials_dimensions","route":"/fundamentals/{id}/standardized_financials/dimensions/{tag}","pathParams":["id","tag"],"queryParams":[],"array":"dimensions","parent":"fundamental","pagination":"non-paged-response-model"},{"id":"bulk-index","method":"GET","apiClass":"BulkDownloadsApi","apiMethod":"get_bulk_download_links","route":"/bulk_downloads/links","pathParams":[],"queryParams":[],"array":"bulk_downloads","parent":null,"pagination":"non-paged-response-model"}]''')
OPERATIONS = {row["id"]: row for row in REGISTRY}
SECRET_KEYS = {"api_key", "apikey", "api-key", "access_token", "token", "password", "authorization"}
PAGED = {"next_page", "next_page-model-generated-method-has-no-cursor"}


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def raw_json(data):
    def reject(value):
        raise ValueError("Non-JSON numeric constant: " + value)
    return json.loads(data.decode("utf-8-sig"), parse_float=decimal.Decimal,
                      parse_int=int, parse_constant=reject)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def atomic_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def atomic_json(path, value):
    atomic_bytes(path, json_bytes(value))


def identifier(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,150}", value):
        raise ValueError(label + " must be a nonempty portable identifier")
    return value


def safe_url(value):
    if not value:
        return ""
    if not isinstance(value, str):
        raise ValueError("Source URL must be text")
    parsed = urllib.parse.urlsplit(value)
    if parsed.username or parsed.password:
        raise ValueError("Source URL must not contain credentials")
    pairs = [(k, v) for k, v in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
             if k.lower() not in SECRET_KEYS]
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path,
                                   urllib.parse.urlencode(pairs), parsed.fragment))


def request_url(operation, path_params, query):
    route = operation["route"]
    for key, value in path_params.items():
        route = route.replace("{" + key + "}", urllib.parse.quote(str(value), safe=""))
    pairs = []
    for key, value in query.items():
        if value is not None:
            values = value if isinstance(value, list) else [value]
            for item in values:
                pairs.append((key, str(item).lower() if isinstance(item, bool) else str(item)))
    return API_ORIGIN + route + ("?" + urllib.parse.urlencode(pairs) if pairs else "")


def validate_request(item):
    if not isinstance(item, dict):
        raise ValueError("Each request must be an object")
    identifier(item.get("id"), "Request id")
    if item.get("operation") not in OPERATIONS:
        raise ValueError("Unknown original operation")
    op = OPERATIONS[item["operation"]]
    params = item.get("pathParams", {})
    query = item.get("query", {})
    if not isinstance(params, dict) or not isinstance(query, dict):
        raise ValueError("pathParams and query must be objects")
    if set(params) != set(op["pathParams"]):
        raise ValueError("Path parameters must match the original operation")
    allowed_query = set(op["queryParams"])
    if op["pagination"] == "next_page-model-generated-method-has-no-cursor":
        allowed_query.add("next_page")
    if set(query) - allowed_query:
        raise ValueError("Unsupported original query parameter")
    for key, value in params.items():
        if not isinstance(value, (str, int)) or isinstance(value, bool) or str(value) == "":
            raise ValueError("Path parameter " + key + " must be text or integer")
    for key, value in query.items():
        values = value if isinstance(value, list) else [value]
        if any(x is not None and (not isinstance(x, (str, int, bool)) or isinstance(x, float)) for x in values):
            raise ValueError("Query values must be text, integers, booleans or null")
        if key == "next_page" and value == "":
            raise ValueError("Original SDK drops an empty-string cursor; retain it as unsupported")
    if item.get("role", "primary") not in {"primary", "reference"}:
        raise ValueError("Source role must be primary or reference")
    if "allPages" in item and not isinstance(item["allPages"], bool):
        raise ValueError("allPages must be an explicit boolean")
    for key in ("maxPages",):
        if key in item and (not isinstance(item[key], int) or isinstance(item[key], bool) or item[key] < 1):
            raise ValueError(key + " must be a positive integer")
    return op


@contextlib.contextmanager
def exclusive(root):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(root / ".acquisition.lock", "a+b") as stream:
        stream.seek(0)
        if stream.read(1) == b"":
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            import fcntl
        except ImportError:
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def keep_bytes(root, data, area="captures", suffix=".json"):
    body_sha = digest(data)
    relative = area + "/" + body_sha + suffix
    target = root / relative
    if target.exists():
        if target.read_bytes() != data:
            raise ValueError("Content-addressed source mismatch")
    else:
        atomic_bytes(target, data)
    return {"path": relative, "sha256": body_sha, "bytes": len(data)}


def verified_body(root, record):
    info = record["source"]
    if not re.fullmatch(r"captures/[a-f0-9]{64}\.json", info.get("path", "")):
        raise ValueError("Retained source path is not content-addressed")
    path = root / info["path"]
    data = path.read_bytes()
    if len(data) != info["bytes"] or digest(data) != info["sha256"]:
        raise ValueError("Retained source bytes do not match capture ledger")
    provenance = info.get("provenance", {})
    if provenance.get("metadataSha256"):
        metadata_path = provenance.get("metadataPath", "")
        if not re.fullmatch(r"captures/[a-f0-9]{64}\.capture\.json", metadata_path):
            raise ValueError("Retained capture metadata path is not content-addressed")
        metadata = (root / metadata_path).read_bytes()
        if (len(metadata) != provenance.get("metadataBytes")
                or digest(metadata) != provenance["metadataSha256"]):
            raise ValueError("Retained capture metadata does not match capture ledger")
    return data


def inspect_shape(body, op):
    obj = raw_json(body)
    if not isinstance(obj, dict):
        raise ValueError("The original response must be a JSON object")
    if op["array"] and not isinstance(obj.get(op["array"]), list):
        raise ValueError("Response lacks the original " + op["array"] + " array")
    if not op["array"] and not isinstance(obj.get("id"), str):
        raise ValueError("Response lacks its original object id")
    parent = obj.get(op["parent"]) if op["parent"] else obj
    parent_id = parent.get("id") if isinstance(parent, dict) else None
    if op["parent"] and (not isinstance(parent_id, str) or not parent_id):
        raise ValueError("Response lacks its original " + op["parent"] + " identity")
    next_page = obj.get("next_page")
    has_cursor = "next_page" in obj
    if has_cursor and next_page is not None and not isinstance(next_page, str):
        raise ValueError("next_page must be the original string or null")
    return obj, {"rows": len(obj[op["array"]]) if op["array"] else 1,
                 "parentId": parent_id, "nextPage": next_page, "hasNextPage": has_cursor}


def new_ledger(root, config, mode):
    config_sha = digest(canonical(config))
    path = root / "acquisition.json"
    if path.exists():
        ledger = read_json(path)
        if ledger.get("schema") != "tj.intrinio-acquisition.v1" or ledger.get("planSha256") != config_sha:
            raise ValueError("This acquisition directory belongs to a different exact input; use a new directory")
        for record in ledger.get("records", []):
            verified_body(root, record)
        return ledger
    ledger = {"schema": "tj.intrinio-acquisition.v1", "mode": mode,
              "planSha256": config_sha, "createdAt": utc(), "updatedAt": utc(),
              "sdkCommit": SDK_COMMIT, "requests": [], "records": [], "issues": [],
              "collections": {}, "status": "IN_PROGRESS"}
    atomic_json(root / "acquisition-plan.json", config)
    atomic_json(path, ledger)
    return ledger


def save_ledger(root, ledger):
    ledger["updatedAt"] = utc()
    atomic_json(root / "acquisition.json", ledger)


def source_record(root, body, request, captured_at, source_kind, wire, provenance,
                  page_index=0, cursor=None, first=True):
    op = OPERATIONS[request["operation"]]
    info = keep_bytes(root, body)
    record_id = request["id"] + ".page-" + str(page_index)
    descriptor = {"id": record_id, "kind": request["operation"],
                  "role": request.get("role", "primary"), "format": "intrinio-json",
                  **info, "capturedAt": captured_at, "sourceKind": source_kind,
                  "originalWireBytes": bool(wire),
                  "request": {"method": "GET", "apiClass": op["apiClass"],
                              "apiMethod": op["apiMethod"],
                              "pathParams": request.get("pathParams", {}),
                              "query": dict(request.get("query", {})),
                              "url": request_url(op, request.get("pathParams", {}), request.get("query", {}))},
                  "provenance": dict(provenance)}
    descriptor["provenance"]["url"] = safe_url(descriptor["provenance"].get("url", ""))
    if not provenance.get("transformations") and provenance.get("originalEntity"):
        descriptor["provenance"]["originalEntity"] = dict(provenance["originalEntity"])
        descriptor["provenance"]["originalEntity"]["nativeRetainedPath"] = info["path"]
    descriptor["page"] = {"collectionId": request["id"], "index": page_index,
                          "cursor": cursor, "first": bool(first)}
    try:
        _, stats = inspect_shape(body, op)
        validation = {"status": "VALID", **stats}
    except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
        validation = {"status": "INVALID", "code": type(exc).__name__,
                      "message": str(exc)[:240]}
    if len(body) > SOURCE_LIMIT:
        validation["sourceFitsNativeFile"] = False
        validation["nativeFinding"] = "Complete body retained; exceeds original 8 MiB source-file limit"
    else:
        validation["sourceFitsNativeFile"] = True
    validation["metadataFitsNativeFile"] = provenance.get("metadataBytes", 0) <= SOURCE_LIMIT
    return {"requestId": request["id"], "source": descriptor, "validation": validation}


def emit_workspace(root, config, ledger):
    edition_config = config["edition"]
    sources = [row["source"] for row in ledger["records"]
               if row["validation"].get("sourceFitsNativeFile")]
    distinct = {item["path"]: item["bytes"] for item in sources}
    for item in sources:
        provenance = item.get("provenance", {})
        if provenance.get("metadataSha256"):
            distinct[provenance["metadataPath"]] = provenance["metadataBytes"]
    edition = {"id": edition_config["id"], "label": edition_config.get("label", edition_config["id"]),
               "capturedAt": max((s["capturedAt"] for s in sources), default=ledger["createdAt"]),
               "scope": {"description": config.get("description", ""),
                         "requests": ledger["requests"]},
               "sources": sources,
               "acquisition": {"status": ledger["status"],
                               "planSha256": ledger["planSha256"],
                               "collections": ledger["collections"],
                               "issues": ledger["issues"],
                               "unpromotedOriginals": ledger.get("unpromotedOriginals", []),
                               "sourceFilesBytes": sum(distinct.values()),
                               "originalLedger": "acquisition.json",
                               "requiresPartition": sum(distinct.values()) > REVISION_LIMIT or any(not r["validation"].get("sourceFitsNativeFile") or not r["validation"].get("metadataFitsNativeFile", True) for r in ledger["records"]) or bool(ledger.get("unpromotedOriginals"))}}
    for key in ("companyIdentifiers", "expectedFundamentalIds", "expectedFilingIds"):
        if key in config:
            edition["scope"][key] = config[key]
    if config.get("compareToEdition"):
        edition["compareToEdition"] = config["compareToEdition"]
    workspace = {"schema": "tj.intrinio-fundamentals-workspace.v1",
                 "title": config.get("title", "Fundamentals and filing review"),
                 "selectedEdition": edition["id"], "editions": [edition],
                 "reviews": [], "comparisonBindings": [],
                 "export": config.get("export", {"mode": "all", "columns": {
                     "Record": "/id", "Company": "/company/id", "Fundamental": "/fundamental/id",
                     "Statement": "/fundamental/statement_code", "FiscalYear": "/fundamental/fiscal_year",
                     "FiscalPeriod": "/fundamental/fiscal_period", "Tag": "/tag/code",
                     "Value": "/valueText", "Unit": "/unit", "Dimensions": "/dimensions",
                     "SourceSHA256": "/sourceSha256"}})}
    atomic_json(root / "workspace.json", workspace)
    return workspace


def validate_config(config, mode):
    expected = "tj.intrinio-acquisition-plan.v1" if mode == "collect" else "tj.intrinio-import.v1"
    if config.get("schema") != expected:
        raise ValueError("Expected schema " + expected)
    if not isinstance(config.get("edition"), dict):
        raise ValueError("An explicit edition object is required")
    identifier(config["edition"].get("id"), "Edition id")
    rows = config.get("requests" if mode == "collect" else "imports")
    if not isinstance(rows, list) or not rows:
        raise ValueError("A nonempty request/import list is required")
    ids = set()
    for item in rows:
        validate_request(item)
        key = item["id"] if mode == "collect" else (item["id"], item.get("page", {}).get("index", 0))
        if key in ids:
            raise ValueError("Duplicate request/page identity")
        ids.add(key)
    return rows


def collection_result(records, op):
    if not records:
        return {"status": "NOT_STARTED", "pages": 0}
    records = sorted(records, key=lambda r: r["source"]["page"]["index"])
    previous = None
    previous_validation = None
    seen_cursors = set()
    first_source = records[0]["source"]
    first_query = dict(first_source["request"]["query"])
    first_query.pop("next_page", None)
    parent = None
    for index, record in enumerate(records):
        source = record["source"]
        binding = source["page"]
        query = dict(source["request"]["query"])
        query.pop("next_page", None)
        validation = record["validation"]
        if source["kind"] != op["id"]:
            return {"status": "INCONSISTENT", "reason": "Operation changed inside a collection", "pages": len(records)}
        if validation["status"] != "VALID":
            return {"status": "INVALID", "pages": len(records), "lastSource": source["id"]}
        if binding["index"] != index or binding.get("first") is not (index == 0):
            return {"status": "INCOMPLETE", "reason": "Retained collection has a gap or an incorrect first-page binding", "pages": len(records)}
        if query != first_query or source["request"]["pathParams"] != first_source["request"]["pathParams"]:
            return {"status": "INCONSISTENT", "reason": "Request scope changed inside a collection", "pages": len(records)}
        cursor = binding.get("cursor")
        actual_query = source["request"]["query"]
        if index == 0:
            if cursor is not None or "next_page" in actual_query:
                return {"status": "INCONSISTENT", "reason": "The first retained request contains a continuation cursor", "pages": len(records)}
        else:
            if not previous_validation.get("hasNextPage") or previous is None:
                return {"status": "INCONSISTENT", "reason": "A retained page follows a terminal or missing original continuation", "pages": len(records)}
            if not isinstance(cursor, str) or not cursor or "next_page" not in actual_query or actual_query["next_page"] != cursor:
                return {"status": "INCONSISTENT", "reason": "Incoming cursor is not bound to the recorded request query", "pages": len(records)}
            if cursor != previous:
                return {"status": "INCONSISTENT", "reason": "Incoming cursor does not match the prior original response", "pages": len(records)}
        if cursor in seen_cursors:
            return {"status": "INCONSISTENT", "reason": "A retained incoming cursor repeats within the collection", "pages": len(records)}
        seen_cursors.add(cursor)
        current_parent = validation.get("parentId")
        if parent is not None and current_parent != parent:
            return {"status": "INCONSISTENT", "reason": "Original response parent changed", "pages": len(records)}
        if current_parent is not None:
            parent = current_parent
        previous = validation.get("nextPage")
        previous_validation = validation
    rows = sum(r["validation"].get("rows", 0) for r in records)
    fits = all(r["validation"].get("sourceFitsNativeFile")
               and r["validation"].get("metadataFitsNativeFile", True) for r in records)
    last = records[-1]["validation"]
    if op["pagination"] in PAGED and last.get("hasNextPage") and last.get("nextPage") is not None and last["nextPage"] in seen_cursors:
        return {"status": "INCONSISTENT", "reason": "The original response repeats an already-used continuation cursor", "pages": len(records)}
    provenance = first_source.get("provenance", {})
    observed = provenance.get("observedCoverage", {})
    published_example = (
        len(records) == 1
        and first_source.get("sourceKind") == "provider-published-documentation-example"
        and provenance.get("requestBasis") == "published-example"
        and provenance.get("documentationExcerpt") is False
        and observed.get("basis") == "complete-published-example"
        and observed.get("bodyComplete") is True
    )
    if published_example:
        # Completeness applies to this selected, complete published response.
        # Do not add a cursor or infer customer-account collection coverage.
        complete = True
        coverage_basis = "complete-published-example"
        page_chain_complete = None
    elif op["pagination"] not in PAGED:
        complete = len(records) == 1
        coverage_basis = "complete-response"
        page_chain_complete = None
    else:
        complete = bool(last.get("hasNextPage")) and last.get("nextPage") is None
        coverage_basis = "original-api-page-chain"
        page_chain_complete = complete
    return {"status": "COMPLETE" if complete else "INCOMPLETE", "pages": len(records),
            "rows": rows, "parentId": parent, "nextPage": last.get("nextPage"),
            "hasNextPage": last.get("hasNextPage", False), "fitsNativeFiles": fits,
            "coverageBasis": coverage_basis, "pageChainComplete": page_chain_complete,
            "apiCollectionCoverage": "not asserted" if published_example else (
                "complete" if complete else "incomplete")}


def finish(root, config, ledger):
    requests_by_id = {item["id"]: item for item in config.get("requests", config.get("imports", []))}
    for item in ledger.get("expandedRequests", []):
        requests_by_id[item["id"]] = item
    for request_id, item in requests_by_id.items():
        records = [r for r in ledger["records"] if r["requestId"] == request_id]
        ledger["collections"][request_id] = collection_result(records, OPERATIONS[item["operation"]])
        pending = [r for r in ledger.get("unpromotedOriginals", []) if r["requestId"] == request_id]
        if pending:
            ledger["collections"][request_id] = {"status": "SOURCE_REQUIRES_DECODING_OR_PARTITION", "completeOriginals": len(pending), "pages": len(records)}
    collection_values = list(ledger["collections"].values())
    complete = bool(collection_values) and all(x["status"] == "COMPLETE" for x in collection_values)
    ledger["status"] = "COMPLETE" if complete else "INCOMPLETE"
    if ledger.get("unpromotedOriginals") or any(not row["validation"].get("sourceFitsNativeFile") or not row["validation"].get("metadataFitsNativeFile", True) for row in ledger["records"]):
        ledger["status"] = "COMPLETE_REQUIRES_PARTITION" if complete else "INCOMPLETE_REQUIRES_PARTITION"
    save_ledger(root, ledger)
    workspace = emit_workspace(root, config, ledger)
    return {"status": ledger["status"], "editionId": workspace["selectedEdition"],
            "responses": len(ledger["records"]), "collections": len(ledger["collections"]),
            "workspace": str(root / "workspace.json"), "ledger": str(root / "acquisition.json"),
            "requiresPartition": workspace["editions"][0]["acquisition"]["requiresPartition"]}


def import_sources(config, config_path, root):
    rows = validate_config(config, "import")
    with exclusive(root):
        ledger = new_ledger(root, config, "import")
        for item in rows:
            page = item.get("page", {})
            page_index = page.get("index", 0)
            if not isinstance(page_index, int) or isinstance(page_index, bool) or page_index < 0:
                raise ValueError("Imported page index must be a nonnegative integer")
            existing = [r for r in ledger["records"] if r["requestId"] == item["id"]
                        and r["source"]["page"]["index"] == page_index]
            if existing:
                continue
            body_path = Path(item["bodyPath"])
            if not body_path.is_absolute():
                body_path = config_path.parent / body_path
            body = body_path.read_bytes()
            if item.get("sha256") and digest(body) != item["sha256"]:
                raise ValueError("Imported original SHA-256 does not match")
            if "bytes" in item and len(body) != item["bytes"]:
                raise ValueError("Imported original byte count does not match")
            source_kind = item.get("sourceKind")
            if source_kind not in {"provider-api-response", "customer-retained-provider-response",
                                   "provider-published-documentation-example"}:
                raise ValueError("Import needs its actual sourceKind")
            if not isinstance(item.get("originalWireBytes"), bool) or not item.get("capturedAt"):
                raise ValueError("Import needs explicit originalWireBytes and capturedAt")
            provenance = item.get("provenance")
            if not isinstance(provenance, dict) or not all(k in provenance for k in ("url", "description", "requestBasis")):
                raise ValueError("Import needs complete source provenance")
            if provenance.get("requestBasis") not in {"observed-request", "published-example", "retained-customer-record"}:
                raise ValueError("Unknown source requestBasis")
            provenance = dict(provenance)
            if provenance.get("metadataPath"):
                metadata_path = Path(provenance["metadataPath"])
                if not metadata_path.is_absolute():
                    metadata_path = config_path.parent / metadata_path
                metadata = metadata_path.read_bytes()
                if (provenance.get("metadataSha256")
                        and digest(metadata) != provenance["metadataSha256"]):
                    raise ValueError("Imported capture metadata SHA-256 does not match")
                if "metadataBytes" in provenance and len(metadata) != provenance["metadataBytes"]:
                    raise ValueError("Imported capture metadata byte count does not match")
                if not isinstance(raw_json(metadata), dict):
                    raise ValueError("Imported capture metadata must be its original JSON object")
                kept_metadata = keep_bytes(root, metadata, suffix=".capture.json")
                provenance.update(metadataPath=kept_metadata["path"],
                                  metadataSha256=kept_metadata["sha256"],
                                  metadataBytes=kept_metadata["bytes"])
            query = item.get("query", {})
            cursor = page.get("cursor", query.get("next_page"))
            first = page.get("first", "next_page" not in query)
            if not isinstance(first, bool) or (cursor is not None and not isinstance(cursor, str)):
                raise ValueError("Imported first/cursor binding has the wrong type")
            if first and ("next_page" in query or cursor is not None):
                raise ValueError("A first-page claim cannot contain a continuation cursor")
            if "next_page" in query and cursor != query["next_page"]:
                raise ValueError("Imported cursor differs from the actual request query")
            record = source_record(root, body, item, item["capturedAt"], source_kind,
                                   item["originalWireBytes"], provenance, page_index, cursor, first)
            ledger["records"].append(record)
            register_request(ledger, item)
            save_ledger(root, ledger)
        return finish(root, config, ledger)


def make_client(api_key_env):
    from importlib import metadata
    import intrinio_sdk
    secret = os.environ.get(api_key_env)
    if not secret:
        raise ValueError("Set the selected customer API-key environment variable before collect")
    config = intrinio_sdk.Configuration()
    config.api_key["api_key"] = secret
    config.debug = False
    config.host = API_ORIGIN
    client = intrinio_sdk.ApiClient(configuration=config, header_name="Accept-Encoding", header_value="identity")
    try:
        installed = metadata.version("intrinio-sdk")
    except metadata.PackageNotFoundError:
        installed = getattr(intrinio_sdk, "__version__", "unknown")
    return intrinio_sdk, client, {"package": "intrinio-sdk", "version": installed,
                                "contractVersion": SDK_VERSION, "contractCommit": SDK_COMMIT}


def original_request(sdk, client, item, query, timeout):
    op = OPERATIONS[item["operation"]]
    if op["pagination"] == "next_page-model-generated-method-has-no-cursor" and "next_page" in query:
        return client.call_api(op["route"], "GET", path_params=item["pathParams"],
                               query_params=list(query.items()),
                               header_params={"Accept": "application/json", "Accept-Encoding": "identity"},
                               body=None, post_params=[], files={}, response_type=None,
                               auth_settings=["ApiKeyAuth"], _return_http_data_only=True,
                               collection_formats={}, _preload_content=False,
                               _request_timeout=timeout)
    api = getattr(sdk, op["apiClass"])(client)
    return getattr(api, op["apiMethod"])(**item["pathParams"], **query,
                                         _preload_content=False, _request_timeout=timeout)


def fetch_body(root, sdk, client, item, query, timeout):
    requested_at = utc()
    response = original_request(sdk, client, item, query, timeout)
    if isinstance(response, tuple):
        response = response[0]
    wire_dir = root / "originals"
    wire_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(prefix="response-", suffix=".partial", dir=wire_dir)
    if hasattr(os, "fchmod"):
        os.fchmod(fd, 0o600)
    sha = hashlib.sha256()
    count = 0
    try:
        status = int(response.status)
        all_headers = {str(k).lower(): str(v) for k, v in response.getheaders().items()}
        headers = {k: v for k, v in all_headers.items() if k in
                   {"date", "content-type", "content-encoding", "content-length", "etag", "last-modified", "retry-after"}}
        with os.fdopen(fd, "wb") as target:
            while True:
                chunk = response.read(65536, decode_content=False)
                if not chunk:
                    break
                target.write(chunk)
                sha.update(chunk)
                count += len(chunk)
            target.flush()
            os.fsync(target.fileno())
        captured_at = utc()
        wire_sha = sha.hexdigest()
        relative = "originals/" + wire_sha + ".http-body"
        wire_path = root / relative
        if wire_path.exists():
            if wire_path.stat().st_size != count or digest(wire_path.read_bytes()) != wire_sha:
                raise ValueError("Retained original response identity collision")
            os.unlink(temp)
        else:
            os.replace(temp, wire_path)
        wire = {"path": relative, "sha256": wire_sha, "bytes": count,
                "complete": True, "status": status, "headers": headers,
                "requestedAt": requested_at, "capturedAt": captured_at}
        encoding = headers.get("content-encoding", "identity").lower().strip()
        if count > SOURCE_LIMIT:
            return None, wire, [{"kind": "native-input-size", "message": "Complete original retained outside the native 8 MiB file bound"}]
        raw = wire_path.read_bytes()
        if encoding in {"", "identity"}:
            return raw, wire, []
        if encoding not in {"gzip", "x-gzip", "deflate"}:
            return None, wire, [{"kind": "unsupported-content-encoding", "encoding": encoding}]
        try:
            decoder = zlib.decompressobj(31 if encoding in {"gzip", "x-gzip"} else zlib.MAX_WBITS)
            decoded = decoder.decompress(raw, SOURCE_LIMIT + 1)
            if len(decoded) > SOURCE_LIMIT or decoder.unconsumed_tail:
                return None, wire, [{"kind": "native-input-size", "message": "Complete original retained; decoded body exceeds 8 MiB"}]
            decoded += decoder.flush()
            if not decoder.eof or len(decoded) > SOURCE_LIMIT or decoder.unused_data:
                return None, wire, [{"kind": "unsupported-decoding", "message": "Body requires explicit complete decoding outside the native input bound"}]
            return decoded, wire, [{"kind": "http-content-decoding", "encoding": encoding,
                                   "originalSha256": wire_sha, "originalBytes": count}]
        except zlib.error:
            return None, wire, [{"kind": "content-decoding-error", "encoding": encoding}]
    finally:
        try:
            response.close()
        finally:
            if hasattr(response, "release_conn"):
                response.release_conn()
        # A failed or interrupted read remains as .partial and is never promoted.


def register_request(ledger, item):
    op = OPERATIONS[item["operation"]]
    query = dict(item.get("query", {}))
    query.pop("next_page", None)
    meta = {"method": "GET", "apiClass": op["apiClass"], "apiMethod": op["apiMethod"],
            "pathParams": dict(item["pathParams"]), "query": query}
    if meta not in ledger["requests"]:
        ledger["requests"].append(meta)


def collect_one(root, ledger, sdk, client, item, timeout, allowance):
    op = OPERATIONS[item["operation"]]
    existing = [r for r in ledger["records"] if r["requestId"] == item["id"]]
    existing.sort(key=lambda r: r["source"]["page"]["index"])
    if any(x.get("requestId") == item["id"] for x in ledger.get("unpromotedOriginals", [])):
        return False
    coverage = collection_result(existing, op)
    if coverage["status"] == "COMPLETE":
        return False
    if existing and (coverage["status"] in {"INVALID", "INCONSISTENT"} or item.get("allPages", True) is False):
        return False
    query = dict(item.get("query", {}))
    index = len(existing)
    if existing:
        last = existing[-1]["validation"]
        if op["pagination"] not in PAGED or not last.get("hasNextPage") or last.get("nextPage") is None:
            return False
        query["next_page"] = last["nextPage"]
    incoming = {r["source"]["page"]["cursor"] for r in existing}
    while True:
        if allowance["remaining"] is not None and allowance["remaining"] <= 0:
            return True
        if item.get("maxPages") is not None and index >= item["maxPages"]:
            return False
        cursor = query.get("next_page")
        if cursor == "" or cursor in incoming:
            ledger["issues"].append({"requestId": item["id"], "at": utc(),
                                     "code": "CURSOR_UNUSABLE",
                                     "message": "An empty or repeated original continuation is retained; no additional request was made"})
            save_ledger(root, ledger)
            return False
        if allowance["remaining"] is not None:
            allowance["remaining"] -= 1
        ledger["sdkOperations"] = ledger.get("sdkOperations", 0) + 1
        ledger["activeAttempt"] = {"requestId": item["id"], "page": index, "startedAt": utc()}
        save_ledger(root, ledger)
        try:
            body, wire, transforms = fetch_body(root, sdk, client, item, query, timeout)
        except Exception as exc:
            status = getattr(exc, "status", None)
            headers = getattr(exc, "headers", None) or {}
            ledger["issues"].append({"requestId": item["id"], "at": utc(), "page": index,
                                     "code": type(exc).__name__, "httpStatus": status,
                                     "retryAfter": headers.get("retry-after"),
                                     "message": "The original SDK operation failed. Any completed or partial original files remain private; exception text is not copied because it can contain authenticated URLs."})
            ledger.pop("activeAttempt", None)
            save_ledger(root, ledger)
            return status in {401, 403, 429}
        ledger.pop("activeAttempt", None)
        if body is None:
            ledger.setdefault("unpromotedOriginals", []).append({"requestId": item["id"],
                "page": index, "original": wire, "findings": transforms})
            save_ledger(root, ledger)
            return False
        requested = dict(item)
        requested["query"] = dict(query)
        provenance = {"url": request_url(op, item["pathParams"], query),
                      "description": "Original Intrinio SDK response entity captured before model deserialization",
                      "requestBasis": "observed-request", "httpStatus": wire["status"],
                      "requestedAt": wire["requestedAt"], "sdk": ledger["runtimeSdk"],
                      "originalEntity": wire, "transformations": transforms}
        first = index == 0 and "next_page" not in item.get("query", {})
        record = source_record(root, body, requested, wire["capturedAt"], "provider-api-response",
                               not transforms, provenance, index, cursor, first)
        ledger["records"].append(record)
        save_ledger(root, ledger)
        index += 1
        validation = record["validation"]
        if validation["status"] != "VALID" or op["pagination"] not in PAGED:
            return False
        if not validation.get("hasNextPage") or validation.get("nextPage") is None:
            return False
        if item.get("allPages", True) is False:
            return False
        incoming.add(cursor)
        query["next_page"] = validation["nextPage"]


def expanded_requests(root, config, ledger):
    out = []
    for expansion in config.get("expandFundamentals", []):
        origin = expansion["fromRequest"]
        ids = set()
        for record in ledger["records"]:
            if record["requestId"] != origin or record["validation"]["status"] != "VALID":
                continue
            source = record["source"]
            obj = raw_json(verified_body(root, record))
            if source["kind"] in {"company-fundamentals", "filing-fundamentals"}:
                values = obj["fundamentals"]
            elif source["kind"] in {"fundamental", "fundamental-lookup"}:
                values = [obj]
            else:
                raise ValueError("Fundamental expansion needs an original fundamental or fundamental listing")
            for value in values:
                if isinstance(value, dict) and isinstance(value.get("id"), str):
                    ids.add(value["id"])
        kinds = expansion.get("financials", ["reported-financials", "standardized-financials"])
        for fundamental_id in sorted(ids):
            entries = [(kind, {"id": fundamental_id}, "primary") for kind in kinds]
            if expansion.get("includeFundamental", True):
                entries.append(("fundamental", {"id": fundamental_id}, "reference"))
            for tag in expansion.get("dimensionsTags", []):
                entries.append(("standardized-dimensions", {"id": fundamental_id, "tag": tag}, "primary"))
            for kind, params, role in entries:
                key = digest(canonical([origin, kind, params]))[:24]
                request = {"id": "expand-" + key, "operation": kind, "pathParams": params,
                           "query": {}, "role": role, "expandedFrom": origin}
                if "maxPages" in expansion:
                    request["maxPages"] = expansion["maxPages"]
                validate_request(request)
                out.append(request)
    return out


def collect_sources(config, root, key_env, timeout=30, request_limit=None):
    rows = validate_config(config, "collect")
    for expansion in config.get("expandFundamentals", []):
        origin = next((r for r in rows if r["id"] == expansion.get("fromRequest")), None)
        if not origin or origin["operation"] not in {"company-fundamentals", "filing-fundamentals", "fundamental", "fundamental-lookup"}:
            raise ValueError("Each expansion must name a selected fundamental or fundamental-listing request")
        if not set(expansion.get("financials", ["reported-financials", "standardized-financials"])) <= {"reported-financials", "standardized-financials"}:
            raise ValueError("Unknown fundamental financial expansion")
        if any(not isinstance(x, str) or not x for x in expansion.get("dimensionsTags", [])):
            raise ValueError("Dimension tags must be explicit nonempty strings")
    with exclusive(root):
        ledger = new_ledger(root, config, "collect")
        sdk, client, runtime = make_client(key_env)
        ledger["runtimeSdk"] = runtime
        allowance = {"remaining": request_limit}
        try:
            stopped = False
            for item in rows:
                register_request(ledger, item)
            save_ledger(root, ledger)
            for item in rows:
                if collect_one(root, ledger, sdk, client, item, timeout, allowance):
                    stopped = True
                    break
            expanded = expanded_requests(root, config, ledger)
            ledger["expandedRequests"] = expanded
            for item in expanded:
                register_request(ledger, item)
            save_ledger(root, ledger)
            if not stopped:
                for item in expanded:
                    if collect_one(root, ledger, sdk, client, item, timeout, allowance):
                        break
            return finish(root, config, ledger)
        finally:
            if hasattr(client, "close"):
                client.close()
            elif hasattr(client, "rest_client"):
                client.rest_client.pool_manager.clear()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    collect = sub.add_parser("collect", help="Capture or resume explicit original SDK requests")
    collect.add_argument("--plan", required=True)
    collect.add_argument("--out", required=True)
    collect.add_argument("--api-key-env", default="INTRINIO_API_KEY")
    collect.add_argument("--timeout", type=int, default=30)
    collect.add_argument("--request-limit", type=int)
    imported = sub.add_parser("import", help="Retain exact complete supplied response files without network access")
    imported.add_argument("--manifest", required=True)
    imported.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        if args.command == "collect":
            if args.timeout < 1 or (args.request_limit is not None and args.request_limit < 1):
                raise ValueError("Timeout and optional logical SDK-operation limit must be positive")
            config = read_json(args.plan)
            result = collect_sources(config, Path(args.out).resolve(), args.api_key_env,
                                     args.timeout, args.request_limit)
        else:
            config_path = Path(args.manifest).resolve()
            result = import_sources(read_json(config_path), config_path, Path(args.out).resolve())
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["status"] == "COMPLETE" and not result["requiresPartition"] else 2
    except KeyboardInterrupt:
        print(json.dumps({"status": "INTERRUPTED", "message": "Retained originals and capture ledger remain available for the same command to resume"}))
        return 130
    except Exception as exc:
        # Known input errors contain no authenticated request URL. Transport errors
        # are recorded by collect_one without echoing SDK exception strings.
        message = str(exc) if isinstance(exc, (ValueError, FileNotFoundError)) else "Acquisition could not finish; inspect the retained ledger and private originals"
        print(json.dumps({"status": "ERROR", "code": type(exc).__name__, "message": message}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

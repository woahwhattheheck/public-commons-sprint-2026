"""Original-source Diffbot dataset processing for a native Python workspace.

Network and account credentials belong to acquisition.py. This module reads
retained captures, preserves numeric tokens, and builds reviewed customer files.
"""
from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

WORKSPACE_SCHEMA = "tj.diffbot-workspace.v1"
REPORT_SCHEMA = "tj.diffbot-dataset-report.v1"
CAPTURE_SCHEMA = "tj.diffbot-safe-capture.v1"
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_SOURCE_BYTES = 32 * 1024 * 1024
MAX_OUTPUT_BYTES = 1024 * 1024
FORMATS = {
    "diffbot-extract-json", "diffbot-bulk-data-json",
    "diffbot-bulk-status-json", "diffbot-bulk-url-report-csv",
    "diffbot-safe-capture-v1",
}
SECRET_KEYS = {"token", "accesstoken", "apikey", "authorization", "childtokens",
               "secret", "password", "clientsecret", "refreshtoken"}
REDACTED = {"[redacted]", "<redacted>", "redacted", "***"}
NUMBER_RE = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")
DEFAULT_COLUMNS = {
    "Record": "/id", "Type": "/kind", "Title": "/fields/title",
    "Source": "/sourceUrl", "Provider identity": "/providerId",
    "Review": "/review/decision",
}


class NumberToken(str):
    """A JSON numeric token, kept exactly as written by its source."""


class DatasetError(ValueError):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code = code
        self.details = details


def _no_duplicate_keys(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise DatasetError("DUPLICATE_JSON_KEY", "A JSON object repeats a key.", key=key)
        out[key] = value
    return out


def _bad_constant(value):
    raise DatasetError("NON_JSON_NUMBER", "A source uses a non-JSON numeric constant.")


def _parse_json(text):
    return json.loads(
        text, parse_int=NumberToken, parse_float=NumberToken,
        parse_constant=_bad_constant, object_pairs_hook=_no_duplicate_keys,
    )


def _json(value, pretty=False):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      indent=2 if pretty else None,
                      separators=None if pretty else (",", ":"))


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _key(value):
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def _pointer_piece(value):
    return str(value).replace("~", "~0").replace("/", "~1")


def _pointer_get(value, pointer):
    if pointer == "":
        return value
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise DatasetError("INVALID_FIELD_POINTER", "A column must use a JSON pointer.")
    current = value
    for part in pointer[1:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict):
            if part not in current:
                return None
            current = current[part]
        elif isinstance(current, list):
            if not re.fullmatch(r"0|[1-9][0-9]*", part):
                return None
            index = int(part)
            if index >= len(current):
                return None
            current = current[index]
        else:
            return None
    return current


def _utc(value, label):
    if not isinstance(value, str) or not value:
        raise DatasetError("MISSING_CAPTURE_TIME", label + " must be an explicit timestamp.")
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise DatasetError("INVALID_CAPTURE_TIME", label + " is not an ISO timestamp.") from exc
    if stamp.tzinfo is None:
        raise DatasetError("MISSING_TIMEZONE", label + " must include a timezone.")
    return stamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _nonempty(value, label):
    if not isinstance(value, str) or isinstance(value, NumberToken) or not value.strip():
        raise DatasetError("MISSING_TEXT", label + " must be a nonempty string.")
    return value


def _safe_url(value):
    if not isinstance(value, str) or isinstance(value, NumberToken):
        return None
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    if parsed.username is not None or parsed.password is not None:
        return None
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
             if _key(k) not in SECRET_KEYS]
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path,
                       urlencode(query), parsed.fragment))


def _credentials(value, pointer=""):
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            where = pointer + "/" + _pointer_piece(key)
            if _key(key) in SECRET_KEYS:
                harmless = item is None or item == "" or (
                    isinstance(item, str) and item.casefold() in REDACTED
                ) or item == []
                if not harmless:
                    found.append(where)
            elif isinstance(item, (dict, list)):
                found.extend(_credentials(item, where))
            elif isinstance(item, str) and item.startswith(("http://", "https://")):
                try:
                    parsed = urlsplit(item)
                    if parsed.username is not None or any(
                        _key(k) in SECRET_KEYS for k, _ in parse_qsl(parsed.query)
                    ):
                        found.append(where)
                except ValueError:
                    pass
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(_credentials(item, pointer + "/" + str(index)))
    return found


def _project(value, pointer="", numbers=None):
    if numbers is None:
        numbers = {}
    if isinstance(value, NumberToken):
        numbers[pointer] = str(value)
        return str(value), numbers
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if _key(key) in SECRET_KEYS:
                continue
            out[key], _ = _project(item, pointer + "/" + _pointer_piece(key), numbers)
        return out, numbers
    if isinstance(value, list):
        out = []
        for index, item in enumerate(value):
            projected, _ = _project(item, pointer + "/" + str(index), numbers)
            out.append(projected)
        return out, numbers
    if value is None or isinstance(value, (str, bool)):
        return value, numbers
    if isinstance(value, (int, float)):
        raise DatasetError("LOST_NUMERIC_TOKEN", "A decoded source number lost its lexical token.")
    raise DatasetError("INVALID_SOURCE_VALUE", "A source contains an unsupported value.")


def _read_file(root, relative, expected_sha, expected_bytes):
    _nonempty(relative, "source path")
    path_part = Path(relative)
    if path_part.is_absolute() or ".." in path_part.parts or not relative.startswith("captures/"):
        raise DatasetError("SOURCE_PATH", "A source must stay under captures/.")
    root = root.resolve()
    file = root / path_part
    if file.is_symlink():
        raise DatasetError("SOURCE_SYMLINK", "Captured inputs must be regular retained files.")
    resolved = file.resolve()
    if root not in resolved.parents or not resolved.is_file():
        raise DatasetError("SOURCE_MISSING", "A retained capture is missing.", path=relative)
    size = resolved.stat().st_size
    if size > MAX_FILE_BYTES:
        raise DatasetError("SOURCE_FILE_LIMIT", "A source exceeds the original 8 MiB file limit.")
    if isinstance(expected_bytes, bool):
        raise DatasetError("SOURCE_BYTES", "Source bytes must be an exact nonnegative integer.")
    try:
        expected_length = int(expected_bytes)
    except (ValueError, TypeError) as exc:
        raise DatasetError("SOURCE_BYTES", "Source bytes must be an exact integer.") from exc
    if str(expected_length) != str(expected_bytes):
        raise DatasetError("SOURCE_BYTES", "Source bytes must use an exact integer value.")
    raw = resolved.read_bytes()
    if len(raw) != expected_length or len(raw) != size:
        raise DatasetError("SOURCE_BYTES_MISMATCH", "A capture no longer matches its retained length.",
                           path=relative)
    if not isinstance(expected_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha):
        raise DatasetError("SOURCE_DIGEST", "A source requires its full SHA-256.")
    if _sha(raw) != expected_sha:
        raise DatasetError("SOURCE_DIGEST_MISMATCH", "A capture no longer matches its retained digest.",
                           path=relative)
    try:
        return raw, raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DatasetError("SOURCE_ENCODING", "A JSON or CSV source must be original UTF-8.") from exc


def _load_workspace(root):
    root = Path(root).resolve()
    path = root / "workspace.json"
    if path.stat().st_size > MAX_FILE_BYTES:
        raise DatasetError("WORKSPACE_FILE_LIMIT", "workspace.json exceeds 8 MiB.")
    document = _parse_json(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schema") != WORKSPACE_SCHEMA:
        raise DatasetError("WORKSPACE_SCHEMA", "Expected " + WORKSPACE_SCHEMA + ".")
    editions = document.get("editions")
    if not isinstance(editions, list) or not editions:
        raise DatasetError("EDITIONS_REQUIRED", "The workspace needs retained source editions.")
    seen_editions = set()
    seen_paths = {}
    for edition in editions:
        if not isinstance(edition, dict):
            raise DatasetError("EDITION_SHAPE", "Every edition must be an object.")
        identity = _nonempty(edition.get("id"), "edition id")
        if identity in seen_editions:
            raise DatasetError("DUPLICATE_EDITION", "An edition id is repeated.", editionId=identity)
        seen_editions.add(identity)
        _utc(edition.get("capturedAt"), "edition capturedAt")
        scope = edition.get("scope")
        if not isinstance(scope, dict) or not isinstance(scope.get("urls"), list):
            raise DatasetError("SCOPE_REQUIRED", "Every edition must retain its selected URLs and scope.")
        if any(_safe_url(url) != url for url in scope["urls"]):
            # Query normalization may differ without a credential; compare only credential safety.
            for url in scope["urls"]:
                if _safe_url(url) is None or _credentials({"sourceUrl": url}):
                    raise DatasetError("SOURCE_URL", "Scope URLs must be credential-free HTTP(S) URLs.")
        sources = edition.get("sources")
        if not isinstance(sources, list):
            raise DatasetError("SOURCES_REQUIRED", "Every edition requires a source list.")
        source_ids = set()
        for source in sources:
            if not isinstance(source, dict):
                raise DatasetError("SOURCE_SHAPE", "Every retained source must be an object.")
            sid = _nonempty(source.get("id"), "source id")
            if sid in source_ids:
                raise DatasetError("DUPLICATE_SOURCE", "A source id is repeated within its edition.", sourceId=sid)
            source_ids.add(sid)
            if source.get("format") not in FORMATS:
                raise DatasetError("SOURCE_FORMAT", "The source format is not supported.", sourceId=sid)
            _utc(source.get("capturedAt"), "source capturedAt")
            raw, text = _read_file(root, source.get("path"), source.get("sha256"), source.get("bytes"))
            previous = seen_paths.get(source["path"])
            current = (source["sha256"], len(raw))
            if previous is not None and previous != current:
                raise DatasetError("SOURCE_REFERENCE_CONFLICT", "One capture path has conflicting references.")
            seen_paths[source["path"]] = current
            if source["format"] == "diffbot-bulk-url-report-csv":
                _csv_payload(text)
            else:
                payload = _parse_json(text)
                if (isinstance(payload, dict) and payload.get("schema") == CAPTURE_SCHEMA
                        and payload.get("format") == "diffbot-bulk-url-report-csv"):
                    _csv_payload(payload.get("payload"))
                if _credentials(payload):
                    raise DatasetError(
                        "CREDENTIAL_IN_PUBLISHABLE_SOURCE",
                        "A capture contains a credential. Use acquisition's safe projection and keep its "
                        "original only in private transport custody.", sourceId=sid,
                    )
    if sum(item[1] for item in seen_paths.values()) + path.stat().st_size > MAX_SOURCE_BYTES:
        raise DatasetError("SOURCE_REVISION_LIMIT", "Inputs exceed the original 32 MiB source revision limit.")
    for key in ("reviews", "resolutions"):
        if key in document and not isinstance(document[key], list):
            raise DatasetError("REVIEW_SHAPE", key + " must be an array.")
    return document


def _csv_payload(text):
    if not isinstance(text, str):
        raise DatasetError("URL_REPORT_TEXT", "The retained CSV projection must be text.")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if reader.fieldnames is None or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise DatasetError("URL_REPORT_HEADERS", "The URL report needs unique original CSV headers.")
    rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise DatasetError("URL_REPORT_COLUMNS", "The URL report contains an inconsistent column count.")
    if _credentials(rows):
        raise DatasetError("CREDENTIAL_IN_PUBLISHABLE_SOURCE",
                           "The retained CSV contains a credential; use a safe acquisition projection.")
    return rows, {"headers": reader.fieldnames}


def _source_payload(root, source):
    raw, text = _read_file(root, source["path"], source["sha256"], source["bytes"])
    fmt = source["format"]
    if fmt == "diffbot-bulk-url-report-csv":
        rows, metadata = _csv_payload(text)
        return fmt, rows, metadata
    payload = _parse_json(text)
    details = {}
    if fmt == "diffbot-safe-capture-v1":
        if not isinstance(payload, dict) or payload.get("schema") != CAPTURE_SCHEMA:
            raise DatasetError("SAFE_CAPTURE_SCHEMA", "The safe capture wrapper has an unexpected schema.")
        fmt = payload.get("format")
        if fmt not in FORMATS - {"diffbot-safe-capture-v1"}:
            raise DatasetError("SAFE_CAPTURE_FORMAT", "The safe capture needs its original JSON format.")
        capture = payload.get("capture", {})
        original = capture.get("original", {})
        if not re.fullmatch(r"[0-9a-f]{64}", str(original.get("sha256", ""))):
            raise DatasetError("ORIGINAL_CAPTURE_DIGEST", "A projection must reference its original digest.")
        details = {"original": _project(original)[0],
                   "redactions": _project(payload.get("redactions", []))[0],
                   "originalFormat": fmt}
        payload = payload.get("payload")
    if fmt == "diffbot-bulk-url-report-csv":
        rows, metadata = _csv_payload(payload)
        return fmt, rows, {**details, **metadata}
    return fmt, payload, details


def _provider_error(payload):
    if not isinstance(payload, dict):
        return None
    if "errorCode" in payload or ("error" in payload and "objects" not in payload and "jobs" not in payload):
        return {"code": str(payload.get("errorCode", "provider-error")),
                "message": str(payload.get("error", "Provider returned an error."))[:1000]}
    return None


def _scope_key(scope):
    return _json(scope)


def _identity(obj, source, edition_id, index):
    uri = obj.get("diffbotUri")
    if isinstance(uri, str) and not isinstance(uri, NumberToken) and uri:
        return "diffbot:" + uri, "diffbot-uri", uri
    original_id = obj.get("id")
    job = source.get("job")
    if original_id is not None and isinstance(job, dict) and job.get("name"):
        if not isinstance(original_id, (str, NumberToken)):
            raise DatasetError("BULK_ID_TYPE", "A Bulk record id must retain its original scalar token.")
        scope = _json([job["name"], str(obj.get("col", "")), str(original_id)])
        return "bulk:" + _sha(scope.encode()), "bulk-job-record", str(original_id)
    scope = _json([edition_id, source["id"], index])
    return "observation:" + _sha(scope.encode()), "edition-local-observation", None


def _record(obj, source, edition, index, request):
    if not isinstance(obj, dict):
        raise DatasetError("OBJECT_SHAPE", "Every extracted record must be a JSON object.", sourceId=source["id"])
    fields, tokens = _project(obj)
    identity, identity_kind, provider_id = _identity(obj, source, edition["id"], index)
    kind = obj.get("type")
    kind = kind if isinstance(kind, str) and not isinstance(kind, NumberToken) else "unknown"
    page_url = obj.get("pageUrl") or request.get("pageUrl")
    original_url = page_url if isinstance(page_url, str) and not isinstance(page_url, NumberToken) else None
    resolved = obj.get("resolvedPageUrl")
    fields_digest = _sha(_json({"fields": fields, "numberTokens": tokens}).encode("utf-8"))
    lineage = {
        "sourceId": source["id"], "sourceSha256": source["sha256"],
        "sourceIndex": index, "sourcePath": source["path"], "fieldSha256": fields_digest,
    }
    return {
        "id": identity, "identityKind": identity_kind, "providerId": provider_id,
        "kind": kind, "sourceId": source["id"], "sourceUrl": original_url,
        "resolvedUrl": resolved if isinstance(resolved, str) else None,
        "capturedAt": source["capturedAt"], "fields": fields, "numberTokens": tokens,
        "lineage": [lineage], "conflicts": [], "fieldSha256": fields_digest,
    }


def _changed_fields(before, after, pointer=""):
    if isinstance(before, dict) and isinstance(after, dict):
        out = []
        for key in sorted(set(before) | set(after)):
            child = pointer + "/" + _pointer_piece(key)
            if key not in before or key not in after:
                out.append(child)
            else:
                out.extend(_changed_fields(before[key], after[key], child))
        return out
    if isinstance(before, list) and isinstance(after, list):
        if len(before) != len(after):
            return [pointer]
        out = []
        for index, (left, right) in enumerate(zip(before, after)):
            out.extend(_changed_fields(left, right, pointer + "/" + str(index)))
        return out
    return [] if type(before) is type(after) and before == after else [pointer]


def _validate_review(review):
    if not isinstance(review, dict):
        raise DatasetError("REVIEW_SHAPE", "A review must be an object.")
    _nonempty(review.get("recordId"), "review recordId")
    _nonempty(review.get("editionId"), "review editionId")
    _nonempty(review.get("reviewer"), "reviewer")
    _utc(review.get("at"), "review at")
    if review.get("decision") not in {"accept", "ignore", "revisit"}:
        raise DatasetError("REVIEW_DECISION", "A review decision must be accept, ignore or revisit.")
    if not isinstance(review.get("note", ""), str):
        raise DatasetError("REVIEW_NOTE", "A review note must be text.")


def _latest_reviews(document, edition_id):
    base = document.get("reviews", [])
    if not isinstance(base, list):
        raise DatasetError("REVIEWS_SHAPE", "Reviews must be an append-only array.")
    rows = list(base)
    recurring = document.get("recurring", {})
    if not isinstance(recurring, dict):
        raise DatasetError("RECURRING_CONFIG", "Recurring configuration must be an object.")
    decisions = recurring.get("decisions", [])
    if not isinstance(decisions, list):
        raise DatasetError("RECURRING_DECISIONS", "Recurring decisions must be an array.")
    rows.extend(decisions)
    latest = {}
    for review in rows:
        _validate_review(review)
        if review["editionId"] == edition_id:
            latest[review["recordId"]] = dict(review)
    # Recorded array order is authoritative. Exact-edition recurring decisions
    # follow base dataset reviews, matching the joined recurring consumer.
    return rows, latest

def _collect_edition(document, edition, root):
    source_reports = []
    candidates = []
    jobs = []
    findings = []
    successful = set()
    unsupported = set()
    failed = set()
    url_reports = []
    selected = list(dict.fromkeys(edition["scope"]["urls"]))
    bulk_downloads = []
    for source in edition["sources"]:
        fmt, payload, extra = _source_payload(root, source)
        request = dict(source.get("request", {}))
        context = {
            "id": source["id"], "format": fmt, "path": source["path"],
            "sha256": source["sha256"], "bytes": int(source["bytes"]),
            "capturedAt": source["capturedAt"],
            "sourceKind": source.get("sourceKind", "retained-provider-capture"),
            "originalWireBytes": source.get("originalWireBytes", False),
            "request": _project(request)[0], "recordCount": 0,
            "provenance": _project(source.get("provenance", {}))[0],
            **extra,
        }
        error = _provider_error(payload)
        if error:
            context["state"] = "provider-error"
            context["providerError"] = error
            requested = request.get("pageUrl")
            if requested:
                failed.add(requested)
            findings.append({
                "severity": "warning", "code": "PROVIDER_RESULT_ERROR",
                "sourceId": source["id"],
                "message": "The retained provider response is an error, not an empty successful result.",
                "providerCode": error["code"],
            })
            source_reports.append(context)
            continue
        context["state"] = "retained"
        if fmt == "diffbot-extract-json":
            if not isinstance(payload, dict):
                raise DatasetError("EXTRACT_ENVELOPE", "Extract and Analyze need their original object envelope.")
            provider_request = payload.get("request", {})
            if provider_request and not isinstance(provider_request, dict):
                raise DatasetError("EXTRACT_REQUEST", "The original request member must be an object.")
            requested = provider_request.get("pageUrl") or request.get("pageUrl")
            if request.get("pageUrl") and provider_request.get("pageUrl") and (
                request["pageUrl"] != provider_request["pageUrl"]
            ):
                findings.append({
                    "severity": "warning", "code": "REQUEST_URL_DIFFERS",
                    "sourceId": source["id"],
                    "message": "The recorded request URL and provider request URL differ; both are retained.",
                })
            context["providerRequest"] = _project(provider_request)[0]
            objects = payload.get("objects")
            if objects is None and payload.get("type") == "other":
                objects = []
            if not isinstance(objects, list):
                raise DatasetError("EXTRACT_OBJECTS", "The Extract response requires an objects array.")
            if requested:
                successful.add(requested)
            if payload.get("type") == "other":
                context["classification"] = "other"
                if requested:
                    unsupported.add(requested)
                findings.append({
                    "severity": "info", "code": "UNSUPPORTED_PAGE_CLASSIFICATION",
                    "sourceId": source["id"],
                    "message": "Analyze classified this page as other; no article or product is invented.",
                })
            context["recordCount"] = len(objects)
            for index, obj in enumerate(objects):
                candidates.append(_record(obj, source, edition, index, provider_request or request))
        elif fmt == "diffbot-bulk-data-json":
            if not isinstance(payload, list):
                raise DatasetError("BULK_DATA_ARRAY", "A full Bulk data response must be a JSON array.")
            job = source.get("job", {})
            if not isinstance(job, dict) or not job.get("name"):
                raise DatasetError("BULK_JOB_BINDING", "A Bulk data source needs its exact original job name.")
            context["job"] = _project(job)[0]
            context["recordCount"] = len(payload)
            context["completeDownload"] = source.get("completeDownload") is True
            bulk_downloads.append(context)
            for index, obj in enumerate(payload):
                candidates.append(_record(obj, source, edition, index, request))
        elif fmt == "diffbot-bulk-status-json":
            if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
                raise DatasetError("BULK_STATUS_ENVELOPE", "Bulk metadata requires its original jobs array.")
            for job in payload["jobs"]:
                if not isinstance(job, dict) or not isinstance(job.get("name"), str):
                    raise DatasetError("BULK_STATUS_JOB", "Every Bulk job needs its original name.")
                safe, tokens = _project(job)
                jobs.append({"sourceId": source["id"], "metadata": safe, "numberTokens": tokens})
            context["jobCount"] = len(payload["jobs"])
        elif fmt == "diffbot-bulk-url-report-csv":
            context["headers"] = extra["headers"]
            context["rowCount"] = len(payload)
            mapping = source.get("csvMapping")
            if mapping is None:
                findings.append({
                    "severity": "warning", "code": "URL_REPORT_MAPPING_REQUIRED", "sourceId": source["id"],
                    "message": "The original URL-report CSV is retained. Map its actual headers and "
                               "documented outcomes to establish per-URL coverage.",
                })
            elif not isinstance(mapping, dict):
                raise DatasetError("URL_REPORT_MAPPING", "CSV coverage mapping must be an object.")
            else:
                url_column = mapping.get("url")
                outcome_column = mapping.get("outcome")
                success_values = mapping.get("successValues")
                failure_values = mapping.get("failureValues", [])
                if url_column not in extra["headers"] or outcome_column not in extra["headers"]:
                    raise DatasetError("URL_REPORT_MAPPING", "Mapped columns must exist in the original CSV.")
                if not isinstance(success_values, list) or not success_values:
                    raise DatasetError("URL_REPORT_OUTCOMES", "Document the original successful outcome values.")
                if set(success_values) & set(failure_values):
                    raise DatasetError("URL_REPORT_OUTCOMES", "A CSV outcome cannot be both success and failure.")
                covered = set()
                csv_failed = set()
                unknown = set()
                for row in payload:
                    url = row[url_column]
                    if row[outcome_column] in success_values:
                        covered.add(url)
                    elif row[outcome_column] in failure_values:
                        csv_failed.add(url)
                    else:
                        unknown.add(url)
                job_name = source.get("job", {}).get("name")
                url_reports.append({
                    "sourceId": source["id"], "jobName": job_name,
                    "successfulUrls": sorted(covered), "failedUrls": sorted(csv_failed),
                    "unknownUrls": sorted(unknown),
                })
                context["mappedCoverage"] = url_reports[-1]
        source_reports.append(context)

    # A job's completed status alone says nothing about every selected URL.
    for download in bulk_downloads:
        job_name = download["job"]["name"]
        matching_jobs = [item for item in jobs if item["metadata"]["name"] == job_name]
        complete_jobs = [
            item for item in matching_jobs
            if str(item["metadata"].get("jobStatus", {}).get("status")) == "9"
        ]
        matching_reports = [item for item in url_reports if item["jobName"] == job_name]
        if complete_jobs and download["completeDownload"] and matching_reports:
            for report in matching_reports:
                successful.update(report["successfulUrls"])
                failed.update(report["failedUrls"])
        else:
            findings.append({
                "severity": "warning", "code": "BULK_COVERAGE_UNRESOLVED",
                "sourceId": download["id"],
                "message": "Retain a completed job status, full unbounded download and mapped original "
                           "URL report together to establish selected-URL coverage.",
            })

    by_id = {}
    versions = {}
    for candidate in candidates:
        identity = candidate["id"]
        if identity not in by_id:
            by_id[identity] = candidate
            versions[identity] = [dict(candidate, lineage=list(candidate["lineage"]))]
            continue
        current = by_id[identity]
        current["lineage"].extend(candidate["lineage"])
        if all(item["fieldSha256"] != candidate["fieldSha256"] for item in versions[identity]):
            versions[identity].append(candidate)
    resolutions = {}
    for resolution in document.get("resolutions", []):
        if not isinstance(resolution, dict):
            raise DatasetError("RESOLUTION_SHAPE", "A version resolution must be an object.")
        if resolution.get("editionId") != edition["id"]:
            continue
        _nonempty(resolution.get("recordId"), "resolution recordId")
        _nonempty(resolution.get("sourceId"), "resolution sourceId")
        _nonempty(resolution.get("reviewer"), "resolution reviewer")
        _nonempty(resolution.get("reason"), "resolution reason")
        _utc(resolution.get("at"), "resolution at")
        resolutions[resolution["recordId"]] = resolution
    for identity, variants in versions.items():
        if len(variants) < 2:
            continue
        resolution = resolutions.get(identity)
        chosen = None
        if resolution:
            for candidate in variants:
                for reference in candidate["lineage"]:
                    if reference["sourceId"] == resolution["sourceId"] and str(
                        reference["sourceIndex"]
                    ) == str(resolution.get("sourceIndex")):
                        chosen = candidate
            if chosen is None:
                raise DatasetError("RESOLUTION_REFERENCE", "A resolution does not identify a retained variant.",
                                   recordId=identity)
        references = [{
            "sourceId": candidate["sourceId"],
            "sourceIndex": candidate["lineage"][0]["sourceIndex"],
            "fieldSha256": candidate["fieldSha256"],
        } for candidate in variants]
        if chosen is None:
            by_id[identity]["conflicts"] = references
            by_id[identity]["variantState"] = "unresolved"
            findings.append({
                "severity": "warning", "code": "CONFLICTING_OBJECT_VARIANTS",
                "recordId": identity,
                "message": "The same provider identity has differing retained objects. Review the original "
                           "versions before exporting this record.",
            })
        else:
            all_lineage = by_id[identity]["lineage"]
            by_id[identity] = dict(chosen, lineage=all_lineage, conflicts=[],
                                      variantState="resolved", retainedVariants=references,
                                      resolution=_project(resolution)[0])
    rows, reviews = _latest_reviews(document, edition["id"])
    records = []
    for identity, record in by_id.items():
        review = reviews.get(identity)
        record["review"] = review or {"decision": "unreviewed", "editionId": edition["id"],
                                     "recordId": identity, "note": ""}
        records.append(record)
    missing = set(selected) - successful - failed
    if not selected:
        coverage_state = "selection-empty"
    elif missing:
        coverage_state = "incomplete"
    elif failed:
        coverage_state = "complete-with-failures"
    else:
        coverage_state = "complete"
    if not edition["sources"]:
        coverage_state = "no-source"
    simultaneous = successful & failed
    if simultaneous:
        findings.append({
            "severity": "warning", "code": "URL_OUTCOME_CONFLICT",
            "message": "A selected URL has both successful and failed retained attempts; the attempt "
                       "history remains visible.", "urls": sorted(simultaneous),
        })
    return {
        "schema": REPORT_SCHEMA, "ready": True, "title": document.get("title", "Retained web data"),
        "edition": {
            "id": edition["id"], "label": edition.get("label", edition["id"]),
            "capturedAt": edition["capturedAt"], "scope": _project(edition["scope"])[0],
        },
        "sources": source_reports, "records": records, "jobs": jobs,
        "coverage": {
            "state": coverage_state, "selectedUrls": selected,
            "successfulUrls": sorted(successful & set(selected)),
            "failedUrls": sorted(failed & set(selected)),
            "unsupportedUrls": sorted(unsupported & set(selected)),
            "notSeenUrls": sorted(missing),
            "additionalObservedUrls": sorted(successful - set(selected)),
        },
        "reviews": _project(rows)[0], "findings": findings,
        "summary": {
            "records": len(records), "sourceObjects": len(candidates),
            "kinds": dict(Counter(item["kind"] for item in records)),
            "accepted": sum(item["review"]["decision"] == "accept" for item in records),
            "ignored": sum(item["review"]["decision"] == "ignore" for item in records),
            "revisit": sum(item["review"]["decision"] == "revisit" for item in records),
            "unreviewed": sum(item["review"]["decision"] == "unreviewed" for item in records),
            "conflictingRecords": sum(bool(item["conflicts"]) for item in records),
            "selectedUrls": len(selected),
        },
    }


def _edition(document, identity):
    for edition in document["editions"]:
        if edition["id"] == identity:
            return edition
    raise DatasetError("EDITION_NOT_FOUND", "The selected edition is not retained.", editionId=identity)


def _comparison(current, previous):
    if previous is None:
        return {"baseEditionId": None, "comparableScope": False,
                "added": [], "changed": [], "notSeen": [], "unchanged": []}
    before = {item["id"]: item for item in previous["records"]}
    after = {item["id"]: item for item in current["records"]}
    changes = {
        "baseEditionId": previous["edition"]["id"],
        "comparableScope": _scope_key(previous["edition"]["scope"]) == _scope_key(current["edition"]["scope"]),
        "added": [], "changed": [], "notSeen": [], "unchanged": [],
    }
    def reference(record):
        return {key: record.get(key) for key in (
            "id", "kind", "sourceId", "sourceUrl", "providerId", "capturedAt", "fieldSha256"
        )}
    for identity in sorted(set(before) | set(after)):
        if identity not in before:
            changes["added"].append(reference(after[identity]))
        elif identity not in after:
            changes["notSeen"].append(reference(before[identity]))
        elif before[identity]["fieldSha256"] == after[identity]["fieldSha256"]:
            changes["unchanged"].append(reference(after[identity]))
        else:
            pointers = _changed_fields(
                {"fields": before[identity]["fields"], "numberTokens": before[identity]["numberTokens"]},
                {"fields": after[identity]["fields"], "numberTokens": after[identity]["numberTokens"]},
            )
            changes["changed"].append({
                "id": identity, "before": reference(before[identity]), "after": reference(after[identity]),
                "changedFields": pointers,
            })
    return changes


def _build_report(document, input):
    requested = input.get("editionId") or document.get("selectedEdition")
    chosen = _edition(document, requested)
    root = input["_root"]
    current = _collect_edition(document, chosen, root)
    previous_id = input.get("compareToEdition") or chosen.get("compareToEdition")
    previous = None
    if previous_id:
        if previous_id == requested:
            raise DatasetError("COMPARE_SAME_EDITION", "Choose two distinct retained editions.")
        previous = _collect_edition(document, _edition(document, previous_id), root)
    current["changes"] = _comparison(current, previous)
    current["availableEditions"] = [{
        "id": item["id"], "label": item.get("label", item["id"]), "capturedAt": item["capturedAt"],
        "sourceCount": len(item["sources"]),
    } for item in document["editions"]]
    current["export"] = _project(document.get("export", {"mode": "all", "columns": DEFAULT_COLUMNS}))[0]
    if previous is not None and not current["changes"]["comparableScope"]:
        current["findings"].append({
            "severity": "warning", "code": "DIFFERENT_COMPARISON_SCOPE",
            "message": "The editions have different URL, extractor or field scopes. Their differences "
                       "are shown with that distinction; they are not a same-scope temporal measurement.",
        })
    if previous is not None and current["coverage"]["state"] not in {"complete", "selection-empty"}:
        current["findings"].append({
            "severity": "warning", "code": "COMPARISON_COVERAGE",
            "message": "The current source selection is not wholly successful. Not-seen objects are not "
                       "labelled deleted.",
        })
    return current, previous

def _cell(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return _json(value)
    return str(value)


def _csv_cell(value):
    text = _cell(value)
    if text.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r", "\n")):
        return "'" + text
    return text


def _export_rows(document, report):
    configuration = document.get("export", {})
    if not isinstance(configuration, dict):
        raise DatasetError("EXPORT_CONFIGURATION", "Export configuration must be an object.")
    mode = configuration.get("mode", "all")
    if mode not in {"all", "accepted"}:
        raise DatasetError("EXPORT_MODE", "Export mode must be all or accepted.")
    columns = configuration.get("columns") or DEFAULT_COLUMNS
    if not isinstance(columns, dict) or not columns:
        raise DatasetError("EXPORT_COLUMNS", "At least one named customer column is required.")
    if len(columns) > 100:
        raise DatasetError("EXPORT_COLUMNS", "A customer mapping supports at most 100 explicit columns.")
    for name, pointer in columns.items():
        _nonempty(name, "customer column")
        if not isinstance(pointer, str) or not pointer.startswith("/"):
            raise DatasetError("EXPORT_POINTER", "Every customer column must use a JSON pointer.")
        if pointer.split("/")[1] not in {
            "id", "identityKind", "providerId", "kind", "sourceId", "sourceUrl",
            "resolvedUrl", "capturedAt", "fields", "numberTokens", "review",
        }:
            raise DatasetError("EXPORT_POINTER", "The column points outside the supported record fields.")
        if pointer == "/review" or (pointer.startswith("/review/") and pointer != "/review/decision"):
            raise DatasetError("EXPORT_REVIEW_FIELD", "Customer review columns may select /review/decision; internal reviewer notes and identities stay in the operator workspace.")
    records = [
        record for record in report["records"]
        if not record["conflicts"] and record["review"]["decision"] != "ignore"
        and (mode == "all" or record["review"]["decision"] == "accept")
    ]
    rows = []
    numeric = []
    for record in records:
        row = {}
        numeric_row = {"recordId": record["id"], "columns": {}, "sourceNumberTokens": record["numberTokens"]}
        for column, pointer in columns.items():
            row[column] = _pointer_get(record, pointer)
            field_pointer = pointer[len("/fields"):] if pointer.startswith("/fields/") else None
            if field_pointer is not None and field_pointer in record["numberTokens"]:
                numeric_row["columns"][column] = {
                    "type": "number", "token": record["numberTokens"][field_pointer],
                    "sourcePointer": field_pointer,
                }
        rows.append(row)
        numeric.append(numeric_row)
    return columns, rows, numeric, records


def _html_report(report, columns, rows):
    escape = lambda value: html.escape(_cell(value), quote=True)
    headers = "".join("<th scope=\"col\">" + escape(column) + "</th>" for column in columns)
    body = []
    for row in rows:
        body.append("<tr>" + "".join("<td>" + escape(row[column]) + "</td>" for column in columns) + "</tr>")
    findings = "".join(
        "<li><strong>" + escape(item["code"]) + "</strong> — " + escape(item["message"]) + "</li>"
        for item in report["findings"]
    )
    summary = report["summary"]
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>" + escape(report["title"]) + "</title>"
        "<style>body{margin:0;background:#fff;color:#171717;font:15px/1.55 system-ui,sans-serif}"
        "main{max-width:1400px;margin:auto;padding:32px}h1{font-size:26px;margin:0 0 12px}"
        "h2{font-size:18px;margin-top:28px}p{max-width:90ch}.meta{color:#525252}"
        ".table{overflow:auto;border:1px solid #bdbdbd}table{border-collapse:collapse;width:100%;font-size:13px}"
        "th,td{padding:10px 12px;border-bottom:1px solid #d4d4d4;text-align:left;vertical-align:top;"
        "overflow-wrap:anywhere;max-width:500px}th{background:#f1f1f1}li{margin:8px 0}"
        "@media print{main{padding:0}.table{overflow:visible}th{background:#eee}}</style></head><body><main>"
        "<h1>" + escape(report["title"]) + "</h1><p class=\"meta\">Edition "
        + escape(report["edition"]["label"]) + " · Captured " + escape(report["edition"]["capturedAt"])
        + "</p><p>" + str(len(rows)) + " exported records from " + str(summary["records"])
        + " retained identities. Source coverage: " + escape(report["coverage"]["state"])
        + ". Source numeric tokens remain exact text in this report and in the numeric companion file.</p>"
        "<div class=\"table\"><table><thead><tr>" + headers + "</tr></thead><tbody>"
        + "".join(body) + "</tbody></table></div>"
        "<h2>Source and review</h2><p>Ignored records and unresolved object conflicts are excluded. "
        "The selected export mode and original decisions remain in the complete dataset report. "
        "A missing or not-seen object is not labelled deleted. Provider HTML is displayed only as escaped text.</p>"
        + ("<h2>Findings</h2><ul>" + findings + "</ul>" if findings else "")
        + "</main></body></html>\n"
    )


def _file(name, body):
    raw = body.encode("utf-8")
    return {"name": name, "body": body, "bytes": len(raw), "sha256": _sha(raw)}


def _recurring(document, report, previous):
    configuration = dict(document.get("recurring", {}))
    configuration["decisions"] = list(document.get("reviews", [])) + list(configuration.get("decisions", []))
    try:
        from recurring.report import build_recurring_report, render_recurring_html
    except ModuleNotFoundError as exc:
        if exc.name not in {"recurring", "recurring.report"}:
            raise
        if configuration.get("watchlist"):
            raise DatasetError(
                "RECURRING_SOURCE_REQUIRED",
                "This configured watchlist needs the joined recurring source in the original workspace.",
            ) from exc
        return None, None
    result = build_recurring_report(report, previous, configuration)
    if not isinstance(result, dict):
        raise DatasetError("RECURRING_REPORT", "The recurring module must return a report object.")
    rendered = render_recurring_html(result)
    if not isinstance(rendered, str):
        raise DatasetError("RECURRING_HTML", "The recurring module must return HTML text.")
    return result, rendered


def _delivery_text(report, columns, exported, recurring):
    changes = report["changes"]
    numeric_fields = sum(len(record["numberTokens"]) for record in exported)
    return (
        "# Retained web-data handoff\n\n"
        "Workspace: " + str(report["title"]) + "\n\n"
        "Source edition: " + str(report["edition"]["label"]) + " (" + report["edition"]["id"] + "). "
        "Captured at " + report["edition"]["capturedAt"] + ".\n\n"
        "This build exports " + str(len(exported)) + " records using " + str(len(columns))
        + " explicitly mapped customer columns. Coverage is " + report["coverage"]["state"] + ".\n\n"
        "## Included files\n\n"
        "- customer.ndjson: one typed mapped row per line; exact source numbers are represented as text.\n"
        "- customer.csv: spreadsheet-safe reading copy of those same mapped rows.\n"
        "- customer.html: self-contained customer table with source and review context.\n"
        "- review-decisions.json: operator-only retained review, version-resolution and recurring decisions.\n"
        "- source-index.json: original captures, selected scope, coverage and actual job metadata.\n"
        "- number-tokens.json: original numeric tokens and their mapped customer-column relationship.\n"
        "- dataset-report.json: operator-only complete selected dataset, identities, changes, findings and recurring review.\n"
        + ("- recurring-report.json and recurring-report.html: accepted customer watchlist projections, without internal notes.\n"
           if recurring else "")
        + "- DELIVERY.md: this operating explanation.\n\n"
        "## Numeric and identity semantics\n\n"
        "There are " + str(numeric_fields) + " retained numeric tokens on the exported source records. "
        "Large provider IDs, amounts and exponents have not passed through floating-point arithmetic. "
        "number-tokens.json distinguishes original numbers from strings that merely look numeric. "
        "Unknown currency and missing availability remain unknown. Original Diffbot identities remain "
        "opaque; Bulk-only IDs stay scoped to their job, and unidentifiable observations stay edition local.\n\n"
        "## Review and comparison\n\n"
        "Unreviewed records remain labelled unreviewed when export mode is all. Mode accepted includes "
        "only explicitly accepted records. Review array order is authoritative within the exact edition; "
        "recurring decisions follow base dataset reviews. Ignore decisions and unresolved conflicting variants are "
        "excluded. The full original source stays in the retained workspace capture. "
        + ("The comparison uses edition " + str(changes["baseEditionId"]) + "; matching scope is "
           + str(changes["comparableScope"]).lower() + ". " if changes["baseEditionId"] else "")
        + "Not-seen objects are not assumed deleted or withdrawn. Bulk completion does not certify "
        "all selected URLs succeeded; original URL-level outcomes determine coverage.\n\n"
        "## Operating and reopening\n\n"
        "Use the original native workspace to save a reviewed selection, run inspect_dataset, apply "
        "explicit decisions, then run build_dataset. Downloading or reopening this completed build "
        "uses the retained original result and does not request new provider data. A later acquisition "
        "is a separate edition with its actual request, source capture and job identity. Provider "
        "credentials and any credential-bearing raw response remain in private transport custody, "
        "outside publishable source; a sanitized capture retains its original hash and redaction relation.\n"
    )


def _build_files(document, report, previous):
    columns, rows, numeric, exported = _export_rows(document, report)
    report["summary"]["exportedRecords"] = len(exported)
    report["summary"]["exportMode"] = document.get("export", {}).get("mode", "all")
    recurring, rendered_recurring = _recurring(document, report, previous)
    if recurring is not None:
        report["recurring"] = recurring
    csv_buffer = io.StringIO(newline="")
    writer = csv.writer(csv_buffer, lineterminator="\r\n")
    writer.writerow([_csv_cell(column) for column in columns])
    for row in rows:
        writer.writerow([_csv_cell(row[column]) for column in columns])
    decisions = {
        "schema": "tj.diffbot-review-decisions.v1", "editionId": report["edition"]["id"],
        "reviews": report["reviews"], "resolutions": _project(document.get("resolutions", []))[0],
        "recurring": _project(document.get("recurring", {}))[0],
    }
    source_index = {
        "schema": "tj.diffbot-source-index.v1", "edition": report["edition"],
        "sources": report["sources"], "coverage": report["coverage"], "jobs": report["jobs"],
    }
    files = [
        _file("customer.ndjson", "".join(_json(row) + "\n" for row in rows)),
        _file("customer.csv", csv_buffer.getvalue()),
        _file("customer.html", _html_report(report, columns, rows)),
        _file("review-decisions.json", _json(decisions, True) + "\n"),
        _file("source-index.json", _json(source_index, True) + "\n"),
        _file("number-tokens.json", _json({
            "schema": "tj.diffbot-number-tokens.v1", "editionId": report["edition"]["id"],
            "records": numeric,
        }, True) + "\n"),
        _file("dataset-report.json", _json(report) + "\n"),
        _file("DELIVERY.md", _delivery_text(report, columns, exported, recurring)),
    ]
    if recurring is not None:
        files.extend([
            _file("recurring-report.json", _json(recurring["customer"], True) + "\n"),
            _file("recurring-report.html", rendered_recurring),
        ])
    return files


def _plain_output(value):
    if isinstance(value, NumberToken):
        return str(value)
    if isinstance(value, dict):
        return {key: _plain_output(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain_output(item) for item in value]
    return value


def _bounded(result):
    result = _plain_output(result)
    size = len(_json(result).encode("utf-8"))
    if size > MAX_OUTPUT_BYTES:
        return {
            "schema": result.get("schema", REPORT_SCHEMA), "ready": False,
            "edition": result.get("edition"), "summary": result.get("summary"),
            "error": {
                "code": "ORIGINAL_PREVIEW_OUTPUT_LIMIT",
                "message": "This complete result exceeds the original 1 MiB native preview output limit. "
                           "Use an agreed smaller source edition or delivery design; no records were "
                           "silently trimmed and no partial build is marked complete.",
                "serializedBytes": size, "limitBytes": MAX_OUTPUT_BYTES,
            },
            "findings": [], "files": [],
        }
    return result


def _run(input, *, root=None, build=False, customer=False):
    if input is None:
        input = {}
    if not isinstance(input, dict):
        return {"schema": REPORT_SCHEMA, "ready": False,
                "error": {"code": "INPUT_OBJECT", "message": "Input must be an object."}, "files": []}
    request = dict(input)
    request["_root"] = Path(root) if root is not None else Path(__file__).resolve().parent
    try:
        document = _load_workspace(request["_root"])
        report, previous = _build_report(document, request)
        if build:
            report["files"] = _build_files(document, report, previous)
        if customer:
            names = {"customer.ndjson", "customer.csv", "customer.html", "source-index.json",
                     "number-tokens.json", "DELIVERY.md", "recurring-report.json", "recurring-report.html"}
            report = {
                "schema": "tj.diffbot-customer-delivery.v1", "ready": True,
                "title": report["title"], "edition": report["edition"],
                "coverage": report["coverage"], "summary": report["summary"],
                "export": {"mode": document.get("export", {}).get("mode", "all"),
                           "columns": document.get("export", {}).get("columns") or DEFAULT_COLUMNS},
                "files": [item for item in report["files"] if item["name"] in names],
            }
        return _bounded(report)
    except DatasetError as exc:
        return {"schema": REPORT_SCHEMA, "ready": False,
                "error": {"code": exc.code, "message": str(exc), **exc.details}, "findings": [], "files": []}
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return {"schema": REPORT_SCHEMA, "ready": False,
                "error": {"code": "SOURCE_READ", "message": str(exc)}, "findings": [], "files": []}


def inspect_dataset(input=None, *, root=None):
    """Inspect the complete selected retained edition without acquiring new data."""
    return _run(input, root=root, build=False)


def build_dataset(input=None, *, root=None):
    """Build the complete reviewed customer files from the selected retained edition."""
    return _run(input, root=root, build=True)



def customer_dataset(input=None, *, root=None):
    """Return the selected customer files without the private operator report."""
    result = _run(input, root=root, build=True, customer=True)
    if not result.get("ready"):
        result["schema"] = "tj.diffbot-customer-delivery.v1"
    return result


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Operate a retained Diffbot source edition")
    parser.add_argument("command", choices=["inspect", "build", "customer"])
    parser.add_argument("--root", default=".")
    parser.add_argument("--edition")
    parser.add_argument("--compare")
    parser.add_argument("--output", help="Create a new output file; never overwrite an earlier result")
    args = parser.parse_args(argv)
    request = {}
    if args.edition:
        request["editionId"] = args.edition
    if args.compare:
        request["compareToEdition"] = args.compare
    function = {"inspect": inspect_dataset, "build": build_dataset, "customer": customer_dataset}[args.command]
    result = function(request, root=Path(args.root))
    text = _json(result) + "\n"
    if args.output:
        with Path(args.output).open("x", encoding="utf-8") as handle:
            handle.write(text)
    else:
        print(text, end="")
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

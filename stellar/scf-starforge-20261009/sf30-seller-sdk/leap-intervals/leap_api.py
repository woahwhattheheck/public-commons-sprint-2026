"""MIT. Leap's original load API, complete pagination, and retained responses."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import ipaddress
import json
import os
import re
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, HTTPRedirectHandler, HTTPSHandler, build_opener
from uuid import uuid4

from leap_contracts import LeapError, require, identifier, json_bytes, now_text

ORIGINS = {"staging": "https://api.staging.leap.energy", "production": "https://api.leap.energy"}
STATUSES = {"QUEUED", "PROCESSING", "COMPLETED", "FAILED"}
MISSING_FILTERS = {
    "meter_ids", "status", "missing_interval_window_start_date_time_utc",
    "missing_interval_window_end_date_time_utc",
    "submission_deadline_window_start_date_time_utc",
    "submission_deadline_window_end_date_time_utc",
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ProviderError(LeapError):
    def __init__(self, message, *, status=None, receipt=None, retry_after=None, uncertain=False):
        super().__init__("LEAP_PROVIDER", message, status=status, receipt=receipt,
                         retry_after=retry_after, uncertain=uncertain)
        self.status, self.receipt = status, receipt
        self.retry_after, self.uncertain = retry_after, uncertain


def retry_time(value):
    if not value:
        return None
    try:
        if re.fullmatch(r"\d+", value.strip()):
            return (datetime.now(timezone.utc) + timedelta(seconds=int(value))).isoformat().replace("+00:00", "Z")
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError, OverflowError):
        return None


def unsigned_https(value):
    parsed = urlsplit(value)
    require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password
            and parsed.port in {None, 443} and not parsed.fragment,
            "LOCAL_FILE_URL", "Leap's original-file response must supply a complete HTTPS URL.")
    require(parsed.hostname not in {"localhost", "localhost.localdomain"} and not parsed.hostname.endswith(".localhost"),
            "LOCAL_FILE_URL", "The original-file destination must be publicly hosted.")
    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        address = None
    require(address is None or address.is_global, "LOCAL_FILE_URL", "The original-file destination must be publicly hosted.")
    return value


class LeapAPI:
    def __init__(self, workspace):
        self.work = workspace
        self.config = workspace.configuration()
        self.origin = ORIGINS[self.config["environment"]]
        self.token = os.environ.get(self.config["token_env"], "")
        require(self.token and len(self.token) <= 16384 and not re.search(r"[\x00-\x20\x7f]", self.token),
                "LEAP_CREDENTIAL", "Set the selected environment-specific Leap API key in " + self.config["token_env"] + ".")
        self.opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))

    def request(self, method, path, *, query=None, body=None, file_id=None, expected=(200,), json_response=True):
        require(path.startswith("/v") and not any(char in path for char in "\r\n?#"),
                "LOCAL_API_ROUTE", "Use the published original Leap API route.")
        not_before = self.work.meta("provider_not_before")
        if not_before and datetime.fromisoformat(not_before.replace("Z", "+00:00")) > datetime.now(timezone.utc):
            raise ProviderError("Leap's recorded Retry-After has not elapsed.", status=429, retry_after=not_before)
        request_id = str(uuid4())
        url = self.origin + path + ("?" + urlencode(query, doseq=True) if query else "")
        headers = {"Authorization": "Bearer " + self.token, "Accept": "application/json"}
        data, handle = None, None
        if body is not None:
            data = json_bytes(body)
            headers.update({"Content-Type": "application/json", "Content-Length": str(len(data))})
        if file_id is not None:
            source = self.work.blob_path(file_id)
            handle = open(source, "rb")
            data = handle
            headers.update({"Content-Type": "text/csv", "Content-Length": str(source.stat().st_size)})
        receipt = {"id": request_id, "environment": self.config["environment"], "partner_account_id": self.config["partner_account_id"],
                   "method": method, "path": path, "query": query or {}, "started_at": now_text(),
                   "body_sha256": file_id if file_id else hashlib.sha256(data).hexdigest() if data is not None else None,
                   "state": "STARTED"}
        self.work.put("api_receipts", request_id, receipt)
        response = None
        try:
            try:
                response = self.opener.open(Request(url, data=data, headers=headers, method=method), timeout=90)
            except HTTPError as error:
                response = error
            except (URLError, TimeoutError, OSError) as error:
                receipt.update(state="INTERRUPTED", completed_at=now_text(), error=type(error).__name__)
                self.work.put("api_receipts", request_id, receipt)
                raise ProviderError("The Leap request ended before a complete provider response.",
                                    receipt=request_id, uncertain=method == "POST" and path == "/v1.1/interval-data") from error
            status = response.code
            raw = response.read(32 * 1024 * 1024 + 1)
            require(len(raw) <= 32 * 1024 * 1024, "LEAP_RESPONSE_SIZE", "This provider response exceeds the 32 MiB response capacity.")
            secret = self.token.encode("utf-8")
            retained = raw.replace(secret, b"[private API key redacted]") if secret in raw else raw
            blob = self.work.store_bytes(retained, "leap-response-" + request_id + ".json", "provider-response")
            after = retry_time(response.headers.get("Retry-After"))
            receipt.update(state="RETURNED", completed_at=now_text(), status=status, response=blob,
                           response_headers={key: response.headers[key] for key in ("Content-Type", "Retry-After", "Cache-Control")
                                             if response.headers.get(key) is not None},
                           redacted=retained != raw, wire_sha256=hashlib.sha256(raw).hexdigest())
            if response.headers.get("Location"):
                receipt["location_sha256"] = hashlib.sha256(response.headers["Location"].encode()).hexdigest()
            if after:
                receipt["retry_after"] = after
                self.work.setmeta("provider_not_before", after)
            self.work.put("api_receipts", request_id, receipt)
            if status not in expected:
                text = retained.decode("utf-8", "replace")[:1500]
                raise ProviderError("Leap returned HTTP " + str(status) + ": " + text, status=status,
                                    receipt=request_id, retry_after=after,
                                    uncertain=method == "POST" and path == "/v1.1/interval-data" and status >= 500)
            if not json_response:
                return {"status": status, "location": response.headers.get("Location"), "receipt_id": request_id, "response": blob}
            try:
                document = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeError) as error:
                raise ProviderError("The successful Leap response did not contain complete JSON.", status=status,
                                    receipt=request_id, uncertain=method == "POST" and path == "/v1.1/interval-data") from error
            require(isinstance(document, dict), "LEAP_RESPONSE_SHAPE", "The provider response must retain its original JSON object.",
                    receipt=request_id)
            return document, request_id
        finally:
            if handle is not None:
                handle.close()
            if response is not None:
                response.close()

    def meter(self, meter_id):
        value, receipt = self.request("GET", "/v2/meters/" + identifier(meter_id))
        require(value.get("meter_id", "").lower() == meter_id.lower(), "LEAP_METER_ID", "Leap returned a different meter.", receipt=receipt)
        require(value.get("meter_type") == "DEVICE", "LEAP_DEVICE_SCOPE", "This application submits partner-created DEVICE meters.", receipt=receipt)
        require(value.get("is_archived") is False, "LEAP_DEVICE_ARCHIVED", "Select an active device meter.", receipt=receipt)
        return value, receipt

    def upload(self, file_id):
        value, receipt = self.request("POST", "/v1.1/interval-data", query={"schema": "load"}, file_id=file_id)
        try:
            job_id = identifier(value.get("job_id"), "Upload job ID")
        except (ValueError, TypeError) as error:
            raise ProviderError("Leap's accepted response did not contain a usable job ID.", status=200,
                                receipt=receipt, uncertain=True) from error
        return job_id, receipt

    def upload_pages(self, **query):
        token, seen = None, set()
        while True:
            request = {**query, "page_size": 500}
            if token is not None:
                request["page_token"] = token
            value, receipt = self.request("GET", "/v1.1/jobs/interval-data-uploads", query=request)
            require(isinstance(value.get("uploads"), list), "LEAP_UPLOADS_SHAPE", "Retain the complete uploads array.", receipt=receipt)
            for row in value["uploads"]:
                require(isinstance(row, dict) and row.get("status") in STATUSES and isinstance(row.get("last_job_id"), str),
                        "LEAP_UPLOADS_SHAPE", "A current upload row has an unexpected format.", receipt=receipt)
                identifier(row["last_job_id"], "Last upload job ID")
            yield value["uploads"], receipt
            token = value.get("next_page_token")
            if token in {None, ""}:
                break
            require(isinstance(token, str) and token not in seen, "LEAP_CURSOR", "Leap repeated or changed its opaque pagination token.", receipt=receipt)
            seen.add(token)

    def errors(self, job_id):
        value, receipt = self.request("GET", "/v1.1/jobs/interval-data-uploads/" + identifier(job_id, "Upload job ID"))
        require(value.get("job_id", "").lower() == job_id.lower() and isinstance(value.get("errors"), list),
                "LEAP_ERRORS_SHAPE", "Retain the complete original job ID and errors array.", receipt=receipt)
        # The published required arrays conflict with the actual property names.
        # Keep error_summary and all original fields, without manufacturing "summary".
        return value, receipt

    def missing_pages(self, filters):
        require(isinstance(filters, dict) and set(filters) <= MISSING_FILTERS, "LOCAL_MISSING_FILTER",
                "Use the documented missing-window filters; pagination is handled by the application.")
        if "status" in filters:
            require(filters["status"] in {"OPEN", "PENDING"}, "LOCAL_MISSING_STATUS", "Choose OPEN or PENDING.")
        if "meter_ids" in filters:
            require(isinstance(filters["meter_ids"], list), "LOCAL_MISSING_METERS", "Supply an explicit list of device UUIDs.")
            for meter_id in filters["meter_ids"]:
                identifier(meter_id)
        token, seen = None, set()
        while True:
            request = {**filters, "page_size": 500}
            if token is not None:
                request["page_token"] = token
            value, receipt = self.request("POST", "/v1.1/missing-interval-data/search", body=request)
            require(isinstance(value.get("missing_intervals"), list), "LEAP_MISSING_SHAPE", "Retain the complete missing_intervals array.", receipt=receipt)
            yield value["missing_intervals"], receipt
            token = value.get("next_page_token")
            if token in {None, ""}:
                break
            require(isinstance(token, str) and token not in seen, "LEAP_CURSOR", "Leap repeated or changed its opaque pagination token.", receipt=receipt)
            seen.add(token)

    def original_file(self, job_id):
        job_id = identifier(job_id, "Upload job ID")
        value = self.request("GET", "/v1.1/jobs/interval-data-uploads/presigned-url/" + job_id,
                             expected=(302,), json_response=False)
        location = unsigned_https(value.get("location") or "")
        response = None
        for _ in range(6):
            try:
                response = self.opener.open(Request(location, headers={"Accept": "text/csv,application/octet-stream"}, method="GET"), timeout=90)
            except HTTPError as error:
                response = error
            if response.code in {301, 302, 303, 307, 308}:
                next_location = response.headers.get("Location")
                response.close()
                location = unsigned_https(next_location or "")
                continue
            break
        require(response is not None and response.code == 200, "LEAP_ORIGINAL_FILE", "The temporary original-file URL did not return the complete file.",
                receipt=value["receipt_id"])
        try:
            declared = response.headers.get("Content-Length")
            if declared is not None:
                require(declared.isdigit(), "LEAP_ORIGINAL_FILE", "The original file has an invalid declared length.")
            blob = self.work.store_stream(response, "leap-original-" + job_id + ".csv", "provider-original",
                                          expected_bytes=int(declared) if declared is not None else None)
        finally:
            response.close()
        self.work.put("original_files", job_id, {"job_id": job_id, "file": blob, "receipt_id": value["receipt_id"],
                                               "downloaded_at": now_text()})
        return blob

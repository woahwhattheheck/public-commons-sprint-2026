#!/usr/bin/env python3
"""Operate the prepared inventory through NetBox's original scripts/jobs/journal APIs."""
from __future__ import annotations

import argparse
import datetime as dt
from email.utils import parsedate_to_datetime
import hashlib
import html
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request
import uuid
import zipfile

from inventory_migration import (
    InventoryError, MAX_RESULT_BYTES, RECEIPT_SCHEMA, REVIEW_SCHEMA, SOURCE_COMMIT,
    canonical, digest, keys, load_json, validate_native_result,
)
from prepare_inventory import (
    json_bytes, load_workspace, now, read_bytes, read_json, sha_bytes, sync_directory,
    workspace_lock, write_atomic, _read_workspace_files,
)

CONNECTION_SCHEMA = "tjlabs.netbox.connection/v1"
ATTEMPT_SCHEMA = "tjlabs.netbox.execution/v1"


class ApiFault(InventoryError):
    def __init__(self, message, status=0, payload=None, meta=None):
        super().__init__(message)
        self.status, self.payload, self.meta = status, payload, meta or {}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


class NativeApi:
    def __init__(self, config):
        keys(config, ("schema", "netbox_url", "script", "token_env", "authorization_scheme", "branch", "timeout_seconds"),
             "Connection")
        if config.get("schema") != CONNECTION_SCHEMA:
            raise InventoryError("Unsupported native connection configuration.")
        base = str(config.get("netbox_url", "")).rstrip("/")
        parsed = urlsplit(base)
        if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise InventoryError("Use the exact native NetBox base URL.")
        script = config.get("script", "inventory_migration.InventoryMigration")
        if not isinstance(script, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*", script):
            raise InventoryError("Use the original uploaded module.ScriptClass identifier.")
        token_env = config.get("token_env", "NETBOX_TOKEN")
        if not isinstance(token_env, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", token_env):
            raise InventoryError("token_env must name an existing environment variable.")
        token = os.environ.get(token_env, "")
        if not token or any(character in token for character in "\r\n\x00"):
            raise InventoryError("Set the original NetBox token in " + token_env + ".")
        scheme = config.get("authorization_scheme", "Bearer")
        if scheme not in ("Bearer", "Token"):
            raise InventoryError("authorization_scheme must match the original Bearer or legacy Token credential.")
        branch = config.get("branch")
        if branch is not None and (not isinstance(branch, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", branch)):
            raise InventoryError("Use the original selected branch ID or omit branch.")
        timeout = config.get("timeout_seconds", 60)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 1 <= timeout <= 600:
            raise InventoryError("timeout_seconds must be between one and 600 seconds.")
        self.base, self.script, self.branch, self.timeout = base, script, branch, timeout
        self.headers = {"Authorization": scheme + " " + token, "Accept": "application/json"}
        if branch:
            self.headers["X-NetBox-Branch"] = branch
        self.opener = build_opener(NoRedirect())

    def url(self, value):
        if value.startswith("/api/"):
            value = self.base + value
        elif value.startswith("/"):
            value = urljoin(self.base + "/", value)
        parsed, original = urlsplit(value), urlsplit(self.base)
        if ((parsed.scheme, parsed.netloc) != (original.scheme, original.netloc)
                or not parsed.path.startswith(original.path.rstrip("/") + "/api/")
                or parsed.username or parsed.password or parsed.fragment):
            raise InventoryError("A native API continuation points outside the selected NetBox API.")
        return value

    def request(self, path, method="GET", body=None, content_type=None):
        url = self.url(path)
        headers = dict(self.headers)
        if content_type:
            headers["Content-Type"] = content_type
        request = Request(url, data=body, method=method, headers=headers)
        try:
            response = self.opener.open(request, timeout=self.timeout)
            with response:
                raw = response.read(MAX_RESULT_BYTES + 1)
                meta = {"status": response.status, "date": response.headers.get("Date"),
                        "content_type": response.headers.get("Content-Type"), "body_sha256": sha_bytes(raw)}
                if len(raw) > MAX_RESULT_BYTES:
                    raise ApiFault("The original API response exceeds 64 MiB.", response.status, meta=meta)
                try:
                    data = load_json(raw, limit=MAX_RESULT_BYTES)
                except InventoryError as exc:
                    raise ApiFault("The original API returned an unreadable JSON response.", response.status, meta=meta) from exc
                return data, meta
        except HTTPError as exc:
            raw = exc.read(MAX_RESULT_BYTES + 1)
            meta = {"status": exc.code, "date": exc.headers.get("Date"), "body_sha256": sha_bytes(raw),
                    "retry_after": exc.headers.get("Retry-After")}
            try:
                payload = load_json(raw, limit=MAX_RESULT_BYTES)
            except InventoryError:
                payload = {"text": raw[:16000].decode("utf-8", errors="replace")}
            raise ApiFault("Native API HTTP " + str(exc.code) + " at " + urlsplit(url).path,
                           exc.code, payload, meta) from exc
        except (URLError, OSError, TimeoutError) as exc:
            raise ApiFault("The native API connection ended: " + str(exc), 0) from exc

    def pages(self, path):
        seen, values, page_receipts = set(), [], []
        current = self.url(path)
        while current:
            if current in seen:
                raise InventoryError("The native API repeated a pagination URL.")
            seen.add(current)
            data, meta = self.request(current)
            if not isinstance(data, dict) or not isinstance(data.get("results"), list):
                raise InventoryError("The original API did not return its paginated result shape.")
            values.extend(data["results"])
            page_receipts.append({"url": current, **meta, "rows": len(data["results"]), "count": data.get("count")})
            next_url = data.get("next")
            if next_url is not None and not isinstance(next_url, str):
                raise InventoryError("Invalid native pagination continuation.")
            current = self.url(next_url) if next_url else None
        return values, page_receipts

    def script_metadata(self):
        value, meta = self.request("/api/extras/scripts/" + quote(self.script, safe=".") + "/")
        if not isinstance(value, dict) or value.get("is_executable") is not True or not isinstance(value.get("id"), int):
            raise InventoryError("The original uploaded inventory script is not executable.")
        expected = {"tenant": "ObjectVar", "inventory": "FileVar",
                    "review_digest": "StringVar", "execution_reference": "StringVar"}
        if value.get("vars") != expected:
            raise InventoryError("The uploaded script variables differ from this inventory source. Install the supplied original script.")
        return value, meta


def bind(root, api, manifest):
    if api.base != manifest["netbox_url"]:
        raise InventoryError("The connection and prepared inventory select different native NetBox base URLs.")
    binding = {"schema": CONNECTION_SCHEMA, "netbox_url": api.base, "script": api.script, "branch": api.branch}
    write_atomic(root / "binding.json", json_bytes(binding), immutable=True)
    return binding


def prefix(operation_id):
    return "TJLabs inventory migration\nOperation: " + operation_id + "\n\n"


def read_native_receipt(api, manifest):
    query = urlencode({"assigned_object_type": "tenancy.tenant", "assigned_object_id": manifest["tenant_id"],
                       "q": "Operation: " + manifest["operation_id"], "limit": 100})
    entries, pages = api.pages("/api/extras/journal-entries/?" + query)
    selected = []
    for entry in entries:
        comments = entry.get("comments") if isinstance(entry, dict) else None
        if isinstance(comments, str) and comments.startswith(prefix(manifest["operation_id"])):
            value = load_json(comments[len(prefix(manifest["operation_id"])):], limit=MAX_RESULT_BYTES)
            validate_native_result(value, manifest["operation_id"], manifest["payload_sha256"])
            if value.get("tenant", {}).get("id") != manifest["tenant_id"]:
                raise InventoryError("The native journal receipt belongs to another tenant.")
            if value["schema"] != RECEIPT_SCHEMA:
                raise InventoryError("The selected native journal entry is not an applied receipt.")
            selected.append((entry, value))
    if len(selected) > 1:
        raise InventoryError("Multiple original journal entries use this operation ID. Select the actual original in NetBox before continuing.")
    if not selected:
        return None, {"scanned_at": now(), "pages": pages, "matching_entries": 0}
    entry, value = selected[0]
    result = {**value, "journal": {"id": entry["id"],
                                  "url": entry.get("display_url") or "/extras/journal-entries/" + str(entry["id"]) + "/"}}
    return result, {"scanned_at": now(), "pages": pages, "matching_entries": 1, "entry": entry}


def current_attempt(root):
    pointer = root / "current.json"
    if not pointer.exists():
        return None, None
    current = read_json(pointer)
    reference = current.get("execution_reference")
    if not isinstance(reference, str) or not re.fullmatch(r"nbx-[0-9a-f]{32}", reference):
        raise InventoryError("Invalid retained current execution reference.")
    directory = root / "attempts" / reference
    request = read_json(directory / "submission.json")
    if request.get("schema") != ATTEMPT_SCHEMA or request.get("execution_reference") != reference:
        raise InventoryError("The retained current execution and request differ.")
    body = read_bytes(directory / "multipart.bin", 16 * 1024 * 1024)
    if len(body) != request["body_bytes"] or sha_bytes(body) != request["body_sha256"]:
        raise InventoryError("The original submitted multipart bytes changed.")
    return directory, request


def set_state(directory, state, **details):
    path = directory / "state.json"
    prior = read_json(path) if path.exists() else {}
    value = {**prior, "state": state, "observed_at": now(), **details}
    write_atomic(path, json_bytes(value))
    return value


def output_from_job(job):
    data = job.get("data") if isinstance(job, dict) else None
    output = data.get("output") if isinstance(data, dict) else None
    if not isinstance(output, str) or not output.strip():
        return None
    try:
        return load_json(output, limit=MAX_RESULT_BYTES)
    except InventoryError:
        return None


def script_identity(value):
    return {name: value.get(name) for name in ("id", "url", "display_url", "module", "name", "description", "vars", "is_executable")}


def receive_job(root, directory, request, job, manifest):
    value = output_from_job(job)
    if not isinstance(value, dict) or value.get("execution_reference") != request["execution_reference"]:
        return None
    retained_job = {key: value for key, value in job.items() if key != "object"}
    write_atomic(directory / "job.json", json_bytes(retained_job))
    if value.get("state") in ("CORRECTION_REQUIRED", "ERROR"):
        result = {"state": value["state"], "execution_reference": request["execution_reference"],
                  "operation_id": manifest["operation_id"], "error": value.get("error"),
                  "job_id": job["id"], "job_status": job.get("status"), "completed": job.get("completed")}
        write_atomic(directory / "result.json", json_bytes(result))
        set_state(directory, value["state"], job_id=job["id"])
        return result
    validate_native_result(value, manifest["operation_id"], manifest["payload_sha256"])
    if not job.get("completed"):
        return None
    if request["phase"] == "APPLY" and value["schema"] != RECEIPT_SCHEMA:
        raise InventoryError("The original apply job returned a review instead of a committed receipt.")
    if value["schema"] == RECEIPT_SCHEMA:
        # The commit record lives in the inventory transaction. Re-read it rather
        # than relying only on Job completion, which is persisted afterwards.
        return None
    write_atomic(directory / "result.json", json_bytes(value))
    write_atomic(root / "review.json", json_bytes(value))
    set_state(directory, "REVIEWED", job_id=job["id"], review_digest=value["review_digest"])
    return value


def recover(root, api, manifest):
    directory, request = current_attempt(root)
    receipt, receipt_source = read_native_receipt(api, manifest)
    if receipt:
        write_atomic(root / "applied.json", json_bytes(receipt), immutable=True)
        if not (root / "journal-source.json").exists():
            write_atomic(root / "journal-source.json", json_bytes(receipt_source), immutable=True)
        if directory:
            write_atomic(directory / "result.json", json_bytes(receipt))
            set_state(directory, "APPLIED", journal_id=receipt["journal"]["id"], review_digest=receipt["review_digest"])
        return receipt
    if directory is None:
        return {"state": "PREPARED", "operation_id": manifest["operation_id"], "native_receipt": receipt_source}
    if request["operation_id"] != manifest["operation_id"] or request["payload_sha256"] != manifest["payload_sha256"]:
        raise InventoryError("The retained execution belongs to another inventory.")
    query = urlencode({"object_type": "extras.script", "object_id": request["script_id"],
                       "created__after": request["native_since"], "limit": 100, "ordering": "-created"})
    jobs, pages = api.pages("/api/core/jobs/?" + query)
    matches, identifiers = [], []
    for job in jobs:
        value = output_from_job(job)
        execution = value.get("execution_reference") if isinstance(value, dict) else None
        identifiers.append({"id": job.get("id"), "job_id": job.get("job_id"), "created": job.get("created"),
                            "completed": job.get("completed"), "status": job.get("status"), "execution_reference": execution})
        if execution == request["execution_reference"]:
            matches.append(job)
    census = {"observed_at": now(), "native_since": request["native_since"], "pages": pages,
              "jobs": identifiers, "matching_job_ids": [job["id"] for job in matches],
              "native_receipt": receipt_source}
    write_atomic(directory / "census.json", json_bytes(census))
    if len(matches) > 1:
        raise InventoryError("More than one native Job uses this execution reference; retain their original IDs for operator reconciliation.")
    if matches:
        received = receive_job(root, directory, request, matches[0], manifest)
        if received:
            return received
        # A job may have just committed after the first journal query.
        receipt, source = read_native_receipt(api, manifest)
        if receipt:
            write_atomic(root / "applied.json", json_bytes(receipt), immutable=True)
            if not (root / "journal-source.json").exists():
                write_atomic(root / "journal-source.json", json_bytes(source), immutable=True)
            write_atomic(directory / "result.json", json_bytes(receipt))
            set_state(directory, "APPLIED", journal_id=receipt["journal"]["id"])
            return receipt
    current = read_json(directory / "state.json")
    preserved = current.get("state") in ("PREPARED", "REJECTED", "AUTH_REQUIRED", "CORRECTION_REQUIRED", "ERROR")
    state = current["state"] if preserved else "AWAITING_NATIVE_RESULT"
    return set_state(directory, state, matching_job_ids=[job["id"] for job in matches],
                     current_native_jobs=len(jobs), execution_reference=request["execution_reference"],
                     operation_id=manifest["operation_id"])


def multipart(packet_bytes, tenant_id, review_digest, reference):
    boundary = "netbox-inventory-" + uuid.uuid4().hex
    while boundary.encode() in packet_bytes:
        boundary = "netbox-inventory-" + uuid.uuid4().hex
    data = {"tenant": tenant_id, "review_digest": review_digest, "execution_reference": reference}
    chunks = []
    for name, value in (("data", canonical(data)), ("commit", "true" if review_digest else "false"),
                        ("notifications", "never")):
        chunks.append(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name
                       + "\"\r\n\r\n" + value + "\r\n").encode())
    chunks += [("--" + boundary + "\r\nContent-Disposition: form-data; name=\"inventory\"; filename=\"request.json\""
                "\r\nContent-Type: application/json\r\n\r\n").encode(), packet_bytes,
               ("\r\n--" + boundary + "--\r\n").encode()]
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary


def dispatch(root, api, manifest, packet_bytes, phase, review_digest="", wait_seconds=0):
    receipt, receipt_source = read_native_receipt(api, manifest)
    if receipt:
        write_atomic(root / "applied.json", json_bytes(receipt), immutable=True)
        if not (root / "journal-source.json").exists():
            write_atomic(root / "journal-source.json", json_bytes(receipt_source), immutable=True)
        return receipt
    if phase == "APPLY":
        review = read_json(root / "review.json")
        validate_native_result(review, manifest["operation_id"], manifest["payload_sha256"])
        if review["schema"] != REVIEW_SCHEMA or review_digest != review.get("review_digest"):
            raise InventoryError("Pass the exact retained completed review_digest for this inventory.")
    script, script_meta = api.script_metadata()
    reference = "nbx-" + uuid.uuid4().hex
    body, content_type = multipart(packet_bytes, manifest["tenant_id"], review_digest if phase == "APPLY" else "", reference)
    try:
        server_time = parsedate_to_datetime(script_meta.get("date") or "").astimezone(dt.timezone.utc)
    except (TypeError, ValueError):
        server_time = dt.datetime.now(dt.timezone.utc)
    request = {"schema": ATTEMPT_SCHEMA, "execution_reference": reference,
               "operation_id": manifest["operation_id"], "payload_sha256": manifest["payload_sha256"],
               "phase": phase, "review_digest": review_digest, "script": api.script, "script_id": script["id"],
               "created_at": now(), "native_since": (server_time - dt.timedelta(minutes=2)).isoformat(),
               "content_type": content_type, "body_sha256": sha_bytes(body), "body_bytes": len(body)}
    directory = root / "attempts" / reference
    write_atomic(directory / "multipart.bin", body, immutable=True)
    write_atomic(directory / "submission.json", json_bytes(request), immutable=True)
    write_atomic(directory / "script-source.json", json_bytes({"script": script_identity(script), "meta": script_meta}), immutable=True)
    set_state(directory, "PREPARED")
    write_atomic(root / "current.json", json_bytes({"execution_reference": reference, "phase": phase}))
    # Durable original request and INVOKING state precede the only POST.
    set_state(directory, "INVOKING")
    try:
        response, meta = api.request("/api/extras/scripts/" + quote(api.script, safe=".") + "/",
                                     method="POST", body=body, content_type=content_type)
        candidate = response.get("result") if isinstance(response, dict) else None
        candidate_identity = ({key: candidate.get(key) for key in ("id", "job_id", "status", "created", "completed", "object_id")}
                              if isinstance(candidate, dict) else None)
        write_atomic(directory / "submission-response.json",
                     json_bytes({"script": script_identity(response), "candidate_job": candidate_identity, "meta": meta}),
                     immutable=True)
        # ScriptDetailSerializer selects the latest job. It is a candidate until
        # original Job.data.output proves this exact execution reference.
        set_state(directory, "AWAITING_NATIVE_RESULT",
                  candidate_job_id=candidate.get("id") if isinstance(candidate, dict) else None)
    except ApiFault as exc:
        error = {"error": str(exc), "status": exc.status, "payload": exc.payload, "meta": exc.meta}
        write_atomic(directory / "submission-fault.json", json_bytes(error), immutable=True)
        state = "AUTH_REQUIRED" if exc.status in (401, 403) else (
            "REJECTED" if exc.status in (400, 404, 405, 413, 415, 422, 429) else "AWAITING_NATIVE_RESULT")
        set_state(directory, state, provider_status=exc.status, error=str(exc))
        if state in ("AUTH_REQUIRED", "REJECTED"):
            return {"state": state, "operation_id": manifest["operation_id"],
                    "execution_reference": reference, **error}
    return wait_for_result(root, api, manifest, wait_seconds)


def wait_for_result(root, api, manifest, wait_seconds):
    deadline = time.monotonic() + wait_seconds
    previous = None
    while True:
        result = recover(root, api, manifest)
        state = result["state"]
        if state != previous:
            print(json.dumps({"operation_id": manifest["operation_id"], "state": state}), flush=True)
            previous = state
        if state in ("APPLIED", "REVIEWED", "CORRECTION_REQUIRED", "ERROR", "REJECTED", "AUTH_REQUIRED"):
            return result
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return result
        time.sleep(min(2.0, remaining))


def inspect(directory):
    root, manifest, packet, _ = load_workspace(directory)
    return _inspect_workspace(root, manifest, packet)


def _inspect_workspace(root, manifest, packet):
    attempt_dir, request = current_attempt(root)
    value = {"state": "PREPARED", "workspace": str(root), "operation_id": manifest["operation_id"],
             "payload_sha256": manifest["payload_sha256"], "netbox_url": manifest["netbox_url"],
             "tenant_id": manifest["tenant_id"], "objects": len(packet["objects"])}
    if (root / "review.json").exists():
        review = read_json(root / "review.json")
        validate_native_result(review, manifest["operation_id"], manifest["payload_sha256"])
        value.update(state="REVIEWED", review_digest=review["review_digest"], counts=review["counts"])
    if request:
        state = read_json(attempt_dir / "state.json")
        value.update(state=state["state"], execution_reference=request["execution_reference"], phase=request["phase"])
    if (root / "applied.json").exists():
        receipt = read_json(root / "applied.json")
        validate_native_result(receipt, manifest["operation_id"], manifest["payload_sha256"])
        value.update(state="APPLIED", journal=receipt["journal"], counts=receipt["counts"],
                     review_digest=receipt["review_digest"], receipt_sha256=receipt["receipt_sha256"])
    return value


def report(directory):
    root, manifest, packet, _ = load_workspace(directory)
    status = inspect(root)
    chosen = root / ("applied.json" if status["state"] == "APPLIED" else "review.json")
    result = read_json(chosen) if chosen.exists() else None
    if result:
        validate_native_result(result, manifest["operation_id"], manifest["payload_sha256"])
    esc = lambda value: html.escape(str(value), quote=True)
    rows = []
    for change in (result or {}).get("changes", []):
        rows.append("<tr><td>" + esc(change["kind"]) + "</td><td>" + esc(change["key"])
                    + "</td><td>" + esc(change["action"]) + "</td><td><pre>"
                    + esc(json.dumps(change.get("before"), ensure_ascii=False, indent=2)) + "</pre></td><td><pre>"
                    + esc(json.dumps(change.get("after"), ensure_ascii=False, indent=2)) + "</pre></td></tr>")
    resolved = (result or {}).get("resolved", [])
    links = []
    for row in resolved:
        url = str(row.get("url", ""))
        if url.startswith("/") and not url.startswith("//"):
            url = urljoin(manifest["netbox_url"] + "/", url)
        native, base = urlsplit(url), urlsplit(manifest["netbox_url"])
        if (native.scheme, native.netloc) != (base.scheme, base.netloc):
            continue
        links.append("<li><a href=\"" + esc(url) + "\">" + esc(row["kind"] + "/" + row["key"])
                     + "</a> · native ID " + esc(row["id"]) + "</li>")
    documents = [
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">",
        "<title>Inventory migration · " + esc(manifest["operation_id"]) + "</title>",
        "<style>body{font:14px system-ui,sans-serif;color:#171717;background:#fff;max-width:1400px;margin:32px auto;padding:0 24px}"
        "h1{font-size:24px}h2{font-size:18px;margin-top:32px}table{border-collapse:collapse;width:100%}"
        "th,td{border:1px solid #c8c8c8;padding:8px;vertical-align:top;text-align:left}th{background:#f2f2f2}"
        "pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px ui-monospace,monospace;margin:0}"
        "dt{font-weight:600;margin-top:8px}dd{margin:2px 0 12px;overflow-wrap:anywhere}"
        "input{font:inherit;padding:8px;border:1px solid #888;width:min(520px,90%)}"
        "@media print{input{display:none}body{margin:0;padding:0;font-size:10px}pre{font-size:9px}tr{break-inside:avoid}}</style>",
        "<h1>Customer inventory migration</h1><dl><dt>State</dt><dd>" + esc(status["state"]) + "</dd>",
        "<dt>Operation</dt><dd>" + esc(manifest["operation_id"]) + "</dd><dt>NetBox</dt><dd>" + esc(manifest["netbox_url"]) + "</dd>",
        "<dt>Tenant ID</dt><dd>" + esc(manifest["tenant_id"]) + "</dd><dt>Source payload SHA-256</dt><dd>" + esc(manifest["payload_sha256"]) + "</dd>",
        "<dt>Reviewed digest</dt><dd>" + esc((result or {}).get("review_digest", "Awaiting native review")) + "</dd>",
        "<dt>Native NetBox version</dt><dd>" + esc((result or {}).get("netbox_version", "Awaiting native review")) + "</dd></dl>",
        "<p>Counts describe mapped inventory rows, affected child devices and native cable effects. The complete JSON includes "
        "the original native catalogue and all generated component values and relations.</p>",
        "<h2>Original source files</h2><ul>",
    ]
    documents += ["<li>" + esc(item["name"]) + " · " + esc(item["rows"]) + " rows · <code>"
                  + esc(item["sha256"]) + "</code></li>" for item in packet["sources"]]
    documents += ["</ul><h2>Reviewed changes</h2><label>Find an object <input id=\"find\" type=\"search\"></label>",
                  "<table id=\"changes\"><thead><tr><th>Kind</th><th>Source key</th><th>Action</th><th>Before</th><th>After</th></tr></thead><tbody>",
                  *rows, "</tbody></table><h2>Original native inventory</h2><ul>", *links, "</ul>",
                  "<h2>Operator continuation</h2><p>Use recover to read the original native job and journal. "
                  "A new review preserves this source edition. Corrected source data belongs in a new preparation directory; "
                  "the retained resolved IDs identify the original objects to update.</p>",
                  "<script>document.getElementById('find').addEventListener('input',e=>{const q=e.target.value.toLowerCase();"
                  "for(const r of document.querySelectorAll('#changes tbody tr'))r.hidden=!r.textContent.toLowerCase().includes(q)});</script></html>"]
    from network_report import network_csv, network_html, network_inventory
    network = network_inventory(result)
    export = root / "exports"
    write_atomic(export / "network-commissioning.json", json_bytes(network))
    write_atomic(export / "network-commissioning.csv", network_csv(network))
    write_atomic(export / "network-commissioning.html", network_html(network))
    write_atomic(export / "inventory-review.html", "".join(documents).encode("utf-8"))
    write_atomic(export / "status.json", json_bytes(status))
    if result:
        write_atomic(export / "native-inventory-result.json", json_bytes(result))
    import csv
    import io
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=("kind", "key", "id", "url"))
    writer.writeheader()
    writer.writerows(resolved)
    write_atomic(export / "resolved-objects.csv", output.getvalue().encode("utf-8"))
    return {"state": status["state"], "report": str(export / "inventory-review.html"),
            "native_result": str(export / "native-inventory-result.json") if result else None,
            "resolved_objects": str(export / "resolved-objects.csv"), "objects": len(resolved),
            "network_report": str(export / "network-commissioning.html"),
            "network_json": str(export / "network-commissioning.json"),
            "network_csv": str(export / "network-commissioning.csv"), "network_counts": network["counts"]}


def handover(directory):
    root, manifest, _, _ = load_workspace(directory)
    rendered = report(root)
    files = []
    for name in ("workspace.json", "preparation.json", "mapping.json", "sources.json", "corrections.json",
                 "request.json", "binding.json", "current.json", "review.json", "applied.json", "journal-source.json"):
        path = root / name
        if path.is_file() and not path.is_symlink():
            files.append((path, name))
    for name in ("sources", "attempts", "exports"):
        path = root / name
        if path.exists():
            for candidate in sorted(path.rglob("*")):
                if candidate.is_symlink():
                    raise InventoryError("The customer handover cannot include a symbolic link.")
                if candidate.is_file() and candidate.suffix != ".zip":
                    files.append((candidate, candidate.relative_to(root).as_posix()))
    source_root = Path(__file__).resolve().parent
    for name in ("inventory_migration.py", "prepare_inventory.py", "operate_inventory.py", "network_report.py", "README.md",
                 "workspace/model.py", "workspace/actions.py", "workspace/server.py", "workspace/README.md",
                 "workspace/web/index.html", "workspace/web/app.js", "workspace/web/style.css"):
        path = source_root / name
        if path.is_file():
            files.append((path, "operator-source/" + name))
    entries = []
    for path, name in files:
        signature = file_signature(path)
        length, file_sha = hash_file(path)
        if file_signature(path) != signature:
            raise InventoryError("A customer source file changed during handover: " + name)
        entries.append({"path": name, "bytes": length, "sha256": file_sha})
    archive_manifest = {"schema": "tjlabs.netbox.handover/v1", "operation_id": manifest["operation_id"],
                        "payload_sha256": manifest["payload_sha256"], "state": inspect(root)["state"],
                        "contract_source_commit": SOURCE_COMMIT, "files": entries}
    target = root / "exports" / "inventory-handover.zip"
    import tempfile
    descriptor, temporary = tempfile.mkstemp(prefix=".inventory-handover-", dir=target.parent)
    os.close(descriptor)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path, name in files:
                member = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                member.compress_type, member.create_system = zipfile.ZIP_DEFLATED, 3
                member.external_attr = 0o100600 << 16
                with path.open("rb") as original, archive.open(member, "w") as output:
                    while True:
                        chunk = original.read(1024 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
            member = zipfile.ZipInfo("handover-manifest.json", date_time=(1980, 1, 1, 0, 0, 0))
            member.compress_type, member.create_system = zipfile.ZIP_DEFLATED, 3
            member.external_attr = 0o100600 << 16
            archive.writestr(member, json_bytes(archive_manifest))
        with zipfile.ZipFile(temporary) as archive:
            for entry in entries:
                with archive.open(entry["path"]) as handle:
                    length, file_sha = hash_stream(handle)
                if (length, file_sha) != (entry["bytes"], entry["sha256"]):
                    raise InventoryError("Customer handover readback differs: " + entry["path"])
        with open(temporary, "rb") as handle:
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        sync_directory(target.parent)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    length, archive_sha = hash_file(target)
    result = {**rendered, "archive": str(target), "bytes": length, "sha256": archive_sha,
              "members": len(entries) + 1}
    write_atomic(root / "delivery.json", json_bytes(result))
    return result


def file_signature(path):
    value = Path(path).stat()
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def hash_stream(handle, maximum=512 * 1024 * 1024):
    length, current = 0, hashlib.sha256()
    while True:
        chunk = handle.read(1024 * 1024)
        if not chunk:
            return length, current.hexdigest()
        length += len(chunk)
        if length > maximum:
            raise InventoryError("The selected customer artifact exceeds 512 MiB.")
        current.update(chunk)


def hash_file(path):
    with Path(path).open("rb") as handle:
        return hash_stream(handle)


def _restore_member(archive, entry, root):
    """Stream verified original bytes into an exclusive, synced final file."""
    import tempfile
    parts = entry["path"].split("/")
    parent = root
    for part in parts[:-1]:
        parent = parent / part
        if parent.is_symlink():
            raise InventoryError("An original restore parent became a symbolic link.")
        parent.mkdir(mode=0o700, exist_ok=True)
        if not parent.is_dir():
            raise InventoryError("An original restore parent is not a directory.")
    target = parent / parts[-1]
    if target.is_symlink():
        raise InventoryError("An original restore member became a symbolic link.")
    if target.exists():
        if not target.is_file() or hash_file(target) != (entry["bytes"], entry["sha256"]):
            raise InventoryError("A retained restore member has different original bytes: " + entry["path"])
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".restore-member-", dir=parent)
    try:
        size, current = 0, hashlib.sha256()
        with os.fdopen(descriptor, "wb") as output, archive.open(entry["path"]) as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > entry["bytes"]:
                    raise InventoryError("The original member grew during restore.")
                current.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if (size, current.hexdigest()) != (entry["bytes"], entry["sha256"]):
            raise InventoryError("The original member changed during restore.")
        try:
            os.link(temporary, target)
        except FileExistsError:
            if target.is_symlink() or not target.is_file() or hash_file(target) != (entry["bytes"], entry["sha256"]):
                raise InventoryError("A concurrent restore member differs from the retained original.")
        sync_directory(parent)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def restore(archive_path, directory):
    archive_path = Path(archive_path).resolve()
    length, archive_sha = hash_file(archive_path)
    with workspace_lock(directory) as root:
        marker = root / ".restore-operation.json"
        if marker.exists():
            prior = read_json(marker)
            if prior.get("archive_sha256") != archive_sha:
                raise InventoryError("This restore directory belongs to another retained archive.")
        elif any(path.name != ".inventory.lock" for path in root.iterdir()):
            raise InventoryError("Select an empty directory for this original handover restore.")
        with zipfile.ZipFile(archive_path) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or "handover-manifest.json" not in names:
                raise InventoryError("The original customer archive has duplicate or missing members.")
            info = archive.getinfo("handover-manifest.json")
            if info.file_size > MAX_RESULT_BYTES:
                raise InventoryError("The original handover manifest exceeds its supported size.")
            manifest = load_json(archive.read(info), limit=MAX_RESULT_BYTES)
            keys(manifest, ("schema", "operation_id", "payload_sha256", "state", "contract_source_commit", "files"),
                 "Handover manifest")
            if manifest.get("schema") != "tjlabs.netbox.handover/v1" or not isinstance(manifest.get("files"), list):
                raise InventoryError("Unsupported original customer handover.")
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}", str(manifest.get("operation_id", ""))):
                raise InventoryError("The customer handover needs its original operation identity.")
            if not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("payload_sha256", ""))):
                raise InventoryError("The customer handover needs its original payload identity.")
            entries = manifest["files"]
            expected, total = set(), 0
            for entry in entries:
                keys(entry, ("path", "bytes", "sha256"), "Handover member")
                name = entry.get("path")
                parts = name.split("/") if isinstance(name, str) else []
                if (not parts or any(part in ("", ".", "..") for part in parts)
                        or "\\" in name or "\x00" in name or ":" in name
                        or parts[0] in (".inventory.lock", ".restore-operation.json", "handover-manifest.json")):
                    raise InventoryError("An original archive member has an unsafe relative path.")
                if name in expected:
                    raise InventoryError("The original customer manifest repeats a member.")
                size = entry.get("bytes")
                if not isinstance(size, int) or isinstance(size, bool) or size < 0:
                    raise InventoryError("An original member needs its exact nonnegative byte length.")
                total += size
                if total > 512 * 1024 * 1024:
                    raise InventoryError("The complete customer restore exceeds 512 MiB.")
                if not re.fullmatch(r"[0-9a-f]{64}", str(entry.get("sha256", ""))):
                    raise InventoryError("An original member needs its exact SHA-256.")
                expected.add(name)
            if expected | {"handover-manifest.json"} != set(names):
                raise InventoryError("The archive members differ from their exact original manifest.")
            for name in expected:
                parts = name.split("/")
                if any("/".join(parts[:index]) in expected for index in range(1, len(parts))):
                    raise InventoryError("An original archive file also names a parent directory.")
            for entry in entries:
                member = archive.getinfo(entry["path"])
                mode = (member.external_attr >> 16) & 0o170000
                if member.is_dir() or mode not in (0, 0o100000):
                    raise InventoryError("A customer handover member must be a regular file.")
                if member.file_size != entry["bytes"]:
                    raise InventoryError("The original archive member length is invalid.")
                with archive.open(member) as handle:
                    observed_length, observed_sha = hash_stream(handle)
                if (observed_length, observed_sha) != (entry["bytes"], entry["sha256"]):
                    raise InventoryError("The original archive bytes differ: " + entry["path"])
            state = {"schema": "tjlabs.netbox.restore/v1", "archive_sha256": archive_sha, "archive_bytes": length,
                     "operation_id": manifest["operation_id"], "state": "MATERIALIZING"}
            write_atomic(marker, json_bytes(state))
            for entry in entries:
                _restore_member(archive, entry, root)
            write_atomic(root / "handover-manifest.json", json_bytes(manifest), immutable=True)
            # Keep the original restore unavailable to ordinary operators until
            # every source, result, attempt and operation binding validates.
            _, original, packet, _ = _read_workspace_files(root)
            restored = _inspect_workspace(root, original, packet)
            if (restored["operation_id"] != manifest["operation_id"]
                    or restored["payload_sha256"] != manifest["payload_sha256"]):
                raise InventoryError("The restored original workspace differs from the customer manifest.")
            write_atomic(marker, json_bytes({**state, "state": "COMPLETE"}))
        return {**restored, "archive_sha256": archive_sha, "restored_members": len(entries)}


def operate(action, workspace, *, config=None, review_digest="", refresh=False, wait=0, archive=None):
    """Run the original operator action for the CLI or retained customer desk."""
    if action not in ("inspect", "review", "apply", "recover", "retry-current", "report", "handover", "restore"):
        raise InventoryError("Select an original inventory operator action.")
    if isinstance(wait, bool) or not isinstance(wait, int) or not 0 <= wait <= 600:
        raise InventoryError("--wait must be between zero and 600 seconds.")
    if not isinstance(refresh, bool):
        raise InventoryError("refresh must be a JSON boolean.")
    if action == "restore":
        if not archive:
            raise InventoryError("Select the original --archive for restore.")
        return restore(archive, workspace)
    with workspace_lock(workspace) as root:
        if action in ("inspect", "report", "handover"):
            return {"inspect": inspect, "report": report, "handover": handover}[action](root)
        if not config:
            raise InventoryError("Select the original --config for this native NetBox operation.")
        api = NativeApi(read_json(config))
        root, manifest, packet, packet_bytes = load_workspace(root)
        bind(root, api, manifest)
        if action == "recover":
            return wait_for_result(root, api, manifest, wait)
        if action == "retry-current":
            directory, previous = current_attempt(root)
            if previous is None:
                raise InventoryError("There is no original execution to continue.")
            received = recover(root, api, manifest)
            if received["state"] in ("APPLIED", "REVIEWED"):
                return received
            # The original retry keeps the operation journal and native
            # transaction serialization, after reading its current receipt.
            return dispatch(root, api, manifest, packet_bytes, previous["phase"],
                            previous.get("review_digest", ""), wait)
        phase = "REVIEW" if action == "review" else "APPLY"
        directory, previous = current_attempt(root)
        received = recover(root, api, manifest) if previous else {"state": "PREPARED"}
        if received["state"] == "APPLIED":
            return received
        if previous and received["state"] == "AWAITING_NATIVE_RESULT":
            return wait_for_result(root, api, manifest, wait)
        if phase == "REVIEW" and received["state"] == "REVIEWED" and not refresh:
            return received
        if phase == "APPLY" and not review_digest:
            raise InventoryError("Pass --review-digest from the completed original review.")
        return dispatch(root, api, manifest, packet_bytes, phase, review_digest, wait)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("inspect", "review", "apply", "recover", "retry-current", "report", "handover", "restore"))
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--archive", help="The exact retained customer handover ZIP used by restore.")
    parser.add_argument("--config", help="Private original NetBox connection JSON; token stays in its named environment variable.")
    parser.add_argument("--review-digest", default="", help="Exact completed native review digest required by apply.")
    parser.add_argument("--refresh", action="store_true", help="Create a fresh native dry-run after an earlier review completed.")
    parser.add_argument("--wait", type=int, default=0, help="Seconds to follow the same original native job, from 0 to 600.")
    args = parser.parse_args()
    try:
        result = operate(args.action, args.workspace, config=args.config, review_digest=args.review_digest,
                         refresh=args.refresh, wait=args.wait, archive=args.archive)
        if args.action == "restore":
            print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
            return 0
        shown = {key: value for key, value in result.items()
                 if key in ("state", "operation_id", "execution_reference", "phase", "review_digest", "receipt_sha256",
                            "counts", "journal", "error", "provider_status", "archive", "bytes", "sha256", "members",
                            "report", "native_result", "resolved_objects", "objects", "workspace")}
        shown.setdefault("workspace", str(Path(args.workspace).resolve()))
        if result.get("schema") in (REVIEW_SCHEMA, RECEIPT_SCHEMA):
            shown["retained_result"] = str(Path(args.workspace).resolve() /
                                          ("applied.json" if result["state"] == "APPLIED" else "review.json"))
        print(json.dumps(shown, ensure_ascii=False, indent=2), flush=True)
        return 0 if result.get("state") in ("PREPARED", "REVIEWED", "APPLIED") else 2
    except (InventoryError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({"state": "OPERATOR_ACTION_REQUIRED", "error": str(exc)}, ensure_ascii=False, indent=2), flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

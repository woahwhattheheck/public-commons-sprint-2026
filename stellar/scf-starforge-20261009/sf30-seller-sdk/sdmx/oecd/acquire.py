"""MIT. One retained original OECD read per refresh operation."""
from __future__ import annotations

import base64
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

from bootstrap import InputError, digest, json_bytes, load_json, private_write, sync_dir, now
from workspace import BUNDLE, MAX_SOURCE, month, stable_write


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def refresh_capture(workspace, body):
    capture = workspace.captured(body.get("capture_id"))
    operation = body.get("operation_id")
    if not isinstance(operation, str) or not 1 <= len(operation) <= 120:
        raise InputError("Refresh requires a 1–120 character operation identity")
    start = month(body.get("start_period", "2024-01"), "Acquisition start period")
    end = month(body.get("end_period"), "Acquisition end period", True)
    if end and start > end:
        raise InputError("Acquisition end precedes start")
    countries = sorted(s["country"] for s in capture["series"])
    flow = capture["flow"]
    resource = ",".join([flow["agency_id"], flow["id"], flow["version"]])
    key = "+".join(countries) + ".M.LI.IX._Z.AA.IX._Z.H"
    query = {"startPeriod": start, "format": "genericdata"}
    if end:
        query["endPeriod"] = end
    url = ("https://sdmx.oecd.org/public/rest/data/" + urllib.parse.quote(resource, safe=",@")
           + "/" + urllib.parse.quote(key, safe="+._") + "?" + urllib.parse.urlencode(query))
    request_identity = {"operation_id": operation, "url": url, "previous_capture_id": capture["id"]}
    directory = workspace.root / "exports" / ("acquisition-" + digest(json_bytes(request_identity)))
    directory.mkdir(mode=0o700, exist_ok=True)
    stable_write(directory / "request.json", json_bytes(request_identity))
    response_path, receipt_path = directory / "response.xml", directory / "response.json"
    if receipt_path.exists():
        receipt = load_json(receipt_path.read_bytes())
        if not receipt.get("body_complete") or receipt.get("status") != 200:
            raise InputError("The original read result is retained at " + str(receipt_path) +
                             "; select a new refresh operation for a new provider read")
        raw = response_path.read_bytes()
        if digest(raw) != receipt["sha256"] or len(raw) != receipt["bytes"]:
            raise InputError("The retained acquisition response differs from its original receipt")
    else:
        started = now()
        response = None
        status, headers, error, complete, parts, size = None, [], None, False, [], 0
        try:
            request = urllib.request.Request(url, headers={
                "Accept": "application/vnd.sdmx.genericdata+xml;version=2.1",
                "User-Agent": "StellarForge-OECD/1.0"})
            opener = urllib.request.build_opener(NoRedirect())
            try:
                response = opener.open(request, timeout=120)
            except urllib.error.HTTPError as failure:
                response = failure
            status = response.status if hasattr(response, "status") else response.code
            headers = list(response.headers.items())
            while True:
                chunk = response.read(min(65536, MAX_SOURCE + 1 - size))
                if not chunk:
                    complete = True
                    break
                parts.append(chunk)
                size += len(chunk)
                if size > MAX_SOURCE:
                    error = "Original response exceeded the 16 MiB source limit"
                    break
        except Exception as failure:
            error = type(failure).__name__ + ": " + str(failure)
        finally:
            if response is not None:
                response.close()
        raw = b"".join(parts)
        receipt = {**request_identity, "method": "GET", "started_at": started, "completed_at": now(),
                   "status": status, "headers": headers, "body_complete": complete,
                   "bytes": len(raw), "sha256": digest(raw), "error": error,
                   "attempts": 1}
        stable_write(response_path, raw)
        stable_write(receipt_path, json_bytes(receipt))
        if status != 200 or not complete or error:
            raise InputError("OECD returned an incomplete or unsuccessful source read; original result: " + str(receipt_path))
    members = [{"name": "cli-refresh.xml", "kind": "data", "origin": url,
                "bytes": len(raw), "sha256": digest(raw), "receipt": receipt,
                "content_base64": base64.b64encode(raw).decode("ascii")}]
    for ident in capture["metadata_source_ids"]:
        source = workspace.source.source(ident)["source"]
        raw = workspace.source._source_path(ident).read_bytes()
        members.append({"name": source["name"], "kind": source["kind"], "origin": source.get("origin", ""),
                        "bytes": len(raw), "sha256": ident,
                        "receipt": {"reuse_of_retained_source_sha256": ident},
                        "content_base64": base64.b64encode(raw).decode("ascii")})
    return workspace.capture({"schema": BUNDLE, "operation_id": operation,
                              "label": body.get("label", "OECD CLI refresh · " + receipt["completed_at"]),
                              "files": members})

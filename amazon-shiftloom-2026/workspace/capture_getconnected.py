#!/usr/bin/env python3
"""Capture documented Get Connected reads for an explicitly selected source cohort."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from sources import WorkError, clean_text, digest, fail, json_text, now

BASES = ("https://api.galaxydigital.com/api", "https://www.volunteerapi.com/api", "https://ca.volunteerapi.com/api")
ROUTE = re.compile(r"^/api/(needs|users)/([0-9]+)(/(responses|qualifications))?$")
PAGE_KEYS = {"page", "per_page", "since_id", "since_created", "since_updated", "show_inactive"}
MAX_RESPONSE = 20 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def checked_url(url, base, original_path=None):
    value, expected = urlparse(url), urlparse(base)
    match = ROUTE.fullmatch(value.path)
    if value.scheme != "https" or value.netloc != expected.netloc or value.username or value.password or value.fragment or not match:
        fail("CAPTURE_ROUTE", "The capture follows only documented need, response, user and qualification reads on the selected official region.")
    resource, ident, _, suffix = match.groups()
    if suffix and (resource, suffix) not in (("needs", "responses"), ("users", "qualifications")):
        fail("CAPTURE_ROUTE", "That operation is outside the selected source capture.")
    if original_path and value.path != original_path:
        fail("CAPTURE_PAGE", "The returned next page points to a different original resource.")
    if set(parse_qs(value.query)) - PAGE_KEYS:
        fail("CAPTURE_PAGE", "The returned next page needs an undocumented parameter; its exact link is retained in the captured response.")
    return value


def decode_capture_requests(value):
    """Project retained exact response bytes, preserving each original request association."""
    base = value.get("capture", {}).get("api_base")
    if base not in BASES:
        fail("CAPTURE_REGION", "Choose one of the three documented Get Connected API regions.")
    requests = value.get("requests")
    if not isinstance(requests, list) or not requests:
        fail("CAPTURE_REQUESTS", "The native capture needs its retained request/response records.")
    result = dict(needs=[], responses=[], users=[], qualifications=[])
    locations = {}
    for index, request in enumerate(requests):
        if not isinstance(request, dict) or request.get("method") != "GET" or request.get("status") != 200:
            fail("CAPTURE_REQUEST", "Every imported source response must be a successful retained GET.")
        parsed = checked_url(request.get("url", ""), base)
        try:
            raw = base64.b64decode(request["body_b64"], validate=True)
            body = json.loads(raw.decode("utf-8-sig"))
        except (KeyError, ValueError, UnicodeDecodeError):
            fail("CAPTURE_BYTES", "The retained source response is incomplete.")
        if request.get("sha256") != digest(raw):
            fail("CAPTURE_HASH", "The retained response bytes do not match their capture hash.")
        if not isinstance(body, dict) or "data" not in body:
            fail("CAPTURE_DATA", "The native response has no documented data member.")
        resource, ident, _, suffix = ROUTE.fullmatch(parsed.path).groups()
        rows = body["data"]
        if suffix:
            if not isinstance(rows, list):
                fail("CAPTURE_DATA", "A response or qualification collection must contain its original data array.")
        else:
            if not isinstance(rows, dict) or str(rows.get("id")) != ident:
                fail("CAPTURE_ID", "The original item response does not match its requested ID.")
            rows = [rows]
        for row in rows:
            if not isinstance(row, dict):
                fail("CAPTURE_DATA", "Every native source record must be an object.")
            if row.get("domain_id") not in (None, "") and str(row["domain_id"]) != str(value.get("domain_id")):
                fail("CAPTURE_DOMAIN", "A captured record belongs to a different site/domain.")
        if resource == "needs" and suffix == "responses":
            for row in rows:
                actual = row.get("need")
                actual = actual.get("id") if isinstance(actual, dict) else actual
                if str(actual) != ident:
                    fail("CAPTURE_ID", "A response collection contains a different opportunity ID.")
            for row_index, row in enumerate(rows):
                position = len(result["responses"])
                result["responses"].append(row)
                locations[f"/responses/{position}"] = dict(request_index=index, json_pointer=f"/data/{row_index}")
        elif resource == "users" and suffix == "qualifications":
            position = len(result["qualifications"])
            result["qualifications"].append(dict(user_id=ident, data=rows))
            for row_index in range(len(rows)):
                locations[f"/qualifications/{position}/data/{row_index}"] = dict(request_index=index, json_pointer=f"/data/{row_index}")
        else:
            role = "needs" if resource == "needs" else "users"
            position = len(result[role])
            result[role].append(rows[0])
            locations[f"/{role}/{position}"] = dict(request_index=index, json_pointer="/data")
    return result, locations


def ids(path):
    text = Path(path).read_text(encoding="utf-8-sig")
    values = [item for item in re.split(r"[\s,]+", text.strip()) if item]
    if not values or any(not re.fullmatch(r"[0-9]{1,160}", item) for item in values):
        fail("CAPTURE_IDS", "Supply a file of exact numeric IDs, separated by newlines or commas.")
    return list(dict.fromkeys(values))


def atomic(path, raw):
    temp = path.with_name(path.name + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


class Capture:
    def __init__(self, output, identity, authorization, resume=False):
        self.output = Path(output).expanduser().resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        os.chmod(self.output, 0o700)
        self.pages = self.output / "pages"
        self.pages.mkdir(exist_ok=True)
        self.manifest_path = self.output / "capture.json"
        self.authorization = authorization
        self.base = identity["api_base"]
        self.last_request = 0.0
        self.opener = build_opener(NoRedirect())
        if self.manifest_path.exists():
            if not resume:
                fail("CAPTURE_EXISTS", "This directory already contains a capture. Use --resume for its exact pending reads or a new directory for fresh source.")
            self.manifest = json.loads(self.manifest_path.read_text())
            if self.manifest["identity"] != identity:
                fail("CAPTURE_IDENTITY", "Resume uses the original region, domain and selected cohort IDs.")
        else:
            self.manifest = dict(schema="getconnected.capture-journal.v1", identity=identity, started_at=now(),
                                 complete=False, requests=[], errors=[])
            self.save()
        self.by_url = {entry["url"]: entry for entry in self.manifest["requests"]}

    def save(self):
        atomic(self.manifest_path, (json.dumps(self.manifest, indent=2) + "\n").encode("utf-8"))

    def read(self, url):
        checked_url(url, self.base)
        if url in self.by_url:
            item = self.by_url[url]
            expected_path = "pages/" + hashlib.sha256(url.encode()).hexdigest() + ".json"
            if item.get("body_path") != expected_path:
                fail("CAPTURE_PATH", "The retained response path does not match its original request.")
            raw = (self.output / item["body_path"]).read_bytes()
            if digest(raw) != item["sha256"]:
                fail("CAPTURE_HASH", "An existing capture response changed; restore its original bytes or use a new capture directory.")
            return json.loads(raw.decode("utf-8-sig"))
        for attempt in range(3):
            wait = 0.35 - (time.monotonic() - self.last_request)
            if wait > 0:
                time.sleep(wait)
            self.last_request = time.monotonic()
            request = Request(url, headers={"Authorization": self.authorization, "Accept": "application/json"}, method="GET")
            try:
                with self.opener.open(request, timeout=45) as response:
                    raw = response.read(MAX_RESPONSE + 1)
                    if len(raw) > MAX_RESPONSE:
                        fail("CAPTURE_SIZE", "A native response exceeds 20 MiB; select a smaller original source cohort.")
                    try:
                        body = json.loads(raw.decode("utf-8-sig"))
                    except (ValueError, UnicodeDecodeError):
                        fail("CAPTURE_RESPONSE", "The original source returned an incomplete JSON response.")
                    if response.status != 200 or not isinstance(body, dict) or "data" not in body:
                        fail("CAPTURE_RESPONSE", "The original source did not return its documented data response.")
                    name = "pages/" + hashlib.sha256(url.encode()).hexdigest() + ".json"
                    atomic(self.output / name, raw)
                    receipt = dict(method="GET", url=url, status=response.status, captured_at=now(),
                        sha256=digest(raw), byte_count=len(raw), body_path=name,
                        response_headers={k: response.headers[k] for k in ("Date", "Content-Type", "ETag", "Last-Modified") if response.headers.get(k)})
                    self.manifest["requests"].append(receipt)
                    self.by_url[url] = receipt
                    self.save()
                    return body
            except HTTPError as exc:
                if exc.code == 429 and attempt < 2:
                    try:
                        delay = min(60, max(1, int(exc.headers.get("Retry-After", "5"))))
                    except ValueError:
                        delay = 5
                    time.sleep(delay)
                    continue
                if exc.code in (500, 502, 503, 504) and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                fail("CAPTURE_HTTP", f"The selected original read returned HTTP {exc.code}. Successful source pages remain ready for --resume.")
            except (URLError, TimeoutError) as exc:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                fail("CAPTURE_NETWORK", "The original read did not complete. Successful pages are retained for --resume.")
        fail("CAPTURE_RETRY", "The source read exhausted its retry allowance.")

    def collection(self, path):
        url = self.base + path
        original_path = urlparse(url).path
        visited, rows = set(), []
        while url:
            checked_url(url, self.base, original_path)
            if url in visited:
                fail("CAPTURE_PAGE_LOOP", "The original collection repeats a page link.")
            visited.add(url)
            body = self.read(url)
            if not isinstance(body["data"], list):
                fail("CAPTURE_COLLECTION", "The original collection did not contain a data array.")
            rows.extend(body["data"])
            links = body.get("links") or {}
            next_url = links.get("next") if isinstance(links, dict) else None
            url = urljoin(url, next_url) if isinstance(next_url, str) and next_url else None
        return rows

    def run(self):
        identity = self.manifest["identity"]
        user_ids = set(identity["selected_user_ids"])
        for nid in identity["selected_need_ids"]:
            self.read(self.base + "/needs/" + nid)
            for response in self.collection("/needs/" + nid + "/responses"):
                user = response.get("user")
                user = user.get("id") if isinstance(user, dict) else user
                if not isinstance(user, (str, int)) or not re.fullmatch(r"[0-9]{1,160}", str(user)):
                    fail("CAPTURE_USER", "A native response has no exact volunteer ID.")
                user_ids.add(str(user))
        for uid in sorted(user_ids):
            self.read(self.base + "/users/" + uid)
            self.collection("/users/" + uid + "/qualifications")
        self.manifest.update(complete=True, finished_at=now(), errors=[])
        self.save()
        requests = []
        for entry in self.manifest["requests"]:
            requests.append({**{k: v for k, v in entry.items() if k != "body_path"},
                "body_b64": base64.b64encode((self.output / entry["body_path"]).read_bytes()).decode("ascii")})
        bundle = dict(schema="getconnected.coverage-snapshot.v1", domain_id=identity["domain_id"],
            captured_at=self.manifest["finished_at"], requests=requests,
            capture=dict(api_base=self.base, started_at=self.manifest["started_at"],
                finished_at=self.manifest["finished_at"], complete=True,
                selected_need_ids=identity["selected_need_ids"], selected_user_ids=identity["selected_user_ids"],
                included_response_user_ids=sorted(user_ids),
                scope="Selected opportunities and explicitly selected volunteers, plus users referenced by their responses. Coordinator confirms complete assignment and overlap context."))
        # Re-read the exact captured envelopes before delivery; qualification user IDs come from requests.
        decode_capture_requests(bundle)
        target = self.output / "getconnected-snapshot.json"
        atomic(target, (json.dumps(bundle, indent=2) + "\n").encode("utf-8"))
        return dict(path=str(target), requests=len(requests), included_users=len(user_ids),
                    sha256=digest(target.read_bytes()), byte_count=target.stat().st_size)


def main():
    parser = argparse.ArgumentParser(description="Read-only Get Connected source capture for a selected coverage cohort")
    parser.add_argument("--api-base", choices=BASES, required=True)
    parser.add_argument("--domain-id", required=True)
    parser.add_argument("--need-ids", required=True, help="File of all selected opportunity IDs, including committed overlap/week context")
    parser.add_argument("--user-ids", required=True, help="File of candidate volunteer IDs; assigned response users are included automatically")
    parser.add_argument("--output", required=True, help="Private capture directory")
    parser.add_argument("--authorization-env", default="GET_CONNECTED_AUTHORIZATION", help="Environment variable holding the complete Authorization header value")
    parser.add_argument("--resume", action="store_true", help="Resume successful original reads in the same capture; use a new directory for fresh source")
    args = parser.parse_args()
    capture = None
    try:
        authorization = os.environ.get(args.authorization_env, "")
        if not authorization or any(c in authorization for c in "\r\n"):
            fail("CAPTURE_AUTHORIZATION", "Set the named environment variable to the authorized site's complete API Authorization header value.")
        if not re.fullmatch(r"[0-9]{1,160}", args.domain_id):
            fail("CAPTURE_DOMAIN", "Supply the exact numeric site/domain ID.")
        identity = dict(api_base=args.api_base, domain_id=args.domain_id,
                        selected_need_ids=ids(args.need_ids), selected_user_ids=ids(args.user_ids))
        capture = Capture(args.output, identity, authorization, args.resume)
        print(json_text(capture.run()))
    except WorkError as exc:
        if capture:
            capture.manifest.update(complete=False, errors=[dict(code=exc.code, message=exc.message, at=now())])
            capture.save()
        print(json_text(dict(error=exc.code, message=exc.message)), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


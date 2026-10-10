#!/usr/bin/env python3
"""Source-preserving, read-only x402 Bazaar cross-facilitator interoperability census.

Only performs operator-specified GET requests. Never calls verify/settle or wallets.
The output is a report about claims made by facilitators, not proof of payment.
"""
from __future__ import annotations

import argparse
import base64
import binascii
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import socket
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request

SOURCE_SPEC = "https://github.com/x402-foundation/x402/blob/main/docs/extensions/bazaar.mdx"
SOURCE_BLOB = "70057cd342e53a1b7527239ecf1dff490b3f657c"
MAX_BYTES = 4 * 1024 * 1024
ALLOWED_STATUSES = {"success", "processing", "rejected"}


class CensusError(ValueError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def compact_json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def decode_extension_responses(raw_header: str) -> dict:
    """Decode official Bazaar EXTENSION-RESPONSES (base64 UTF-8 JSON).

    The response is *the facilitator's claim* of cataloging status; it is not an
    authenticated proof of seller ownership, an on-chain receipt, or a promise.
    """
    value = raw_header.strip()
    if value.lower().startswith("extension-responses:"):
        value = value.split(":", 1)[1].strip()
    if not value or len(value) > 32_768:
        raise CensusError("header_empty_or_oversized")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise CensusError("header_invalid_base64") from exc
    if len(decoded) > 16_384:
        raise CensusError("decoded_header_oversized")
    try:
        envelope = json.loads(decoded.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CensusError("header_invalid_utf8_json") from exc
    if not isinstance(envelope, dict) or not isinstance(envelope.get("bazaar"), dict):
        raise CensusError("missing_bazaar_extension")
    bazaar = envelope["bazaar"]
    if bazaar.get("status") not in ALLOWED_STATUSES:
        raise CensusError("invalid_catalog_status")
    if bazaar["status"] == "rejected" and not isinstance(bazaar.get("rejectedReason"), str):
        raise CensusError("rejected_without_reason")
    return {"bazaar": bazaar, "other_extensions": sorted(k for k in envelope if k != "bazaar")}


def _resources(envelope) -> list:
    if isinstance(envelope, list):
        return envelope
    if isinstance(envelope, dict):
        if "resource" in envelope and "type" in envelope:
            return [envelope]  # official upstream docs show a single resource object
        for key in ("items", "resources"):
            if isinstance(envelope.get(key), list):
                return envelope[key]
    raise CensusError("missing_items_or_resources_array")


def _listing_identity(resource: dict) -> tuple:
    kind = resource.get("type")
    uri = resource.get("resource")
    if kind not in ("http", "mcp") or not isinstance(uri, str) or not uri.strip():
        raise CensusError("invalid_type_or_resource")
    tool = ""
    if kind == "mcp":
        try:
            tool = resource["extensions"]["bazaar"]["info"]["input"]["toolName"]
        except (KeyError, TypeError) as exc:
            raise CensusError("mcp_tool_name_missing") from exc
        if not isinstance(tool, str) or not tool.strip():
            raise CensusError("mcp_tool_name_missing")
    # Do NOT collapse percent-encoding, routes, query strings, HTTP and MCP,
    # or silently interpret a URI as proof of the payTo owner.
    return (kind, uri, tool)


def _terms_hash(resource: dict) -> tuple[str, list]:
    accepts = resource.get("accepts")
    if not isinstance(accepts, list) or not accepts:
        raise CensusError("missing_payment_terms")
    terms = []
    for term in accepts:
        if not isinstance(term, dict):
            raise CensusError("invalid_accepts_entry")
        # Only economic/authority terms decide cross-provider conflict.
        terms.append({key: term.get(key) for key in ("scheme", "network", "asset", "payTo", "amount")})
    terms.sort(key=compact_json)
    return digest(compact_json(terms).encode("utf-8")), terms


def census(snapshots: list[dict]) -> dict:
    """Index original provenance without treating facilitator assertions as verified truth."""
    indexed = defaultdict(list)
    problems = []
    provider_meta = []
    for snap in snapshots:
        provider = snap.get("provider", "unattributed")
        receipt = {key: snap.get(key) for key in ("provider", "endpoint", "retrieved_at", "raw_sha256")}
        provider_meta.append(receipt)
        try:
            records = _resources(snap.get("data"))
        except CensusError as exc:
            problems.append({"provider": provider, "reason": str(exc), "index": None})
            continue
        for idx, raw in enumerate(records):
            try:
                if not isinstance(raw, dict):
                    raise CensusError("item_not_object")
                identity = _listing_identity(raw)
                payment_hash, payment_terms = _terms_hash(raw)
                indexed[identity].append({
                    "provider": provider,
                    "endpoint": snap.get("endpoint"),
                    "source_sha256": snap.get("raw_sha256"),
                    "index": idx,
                    "payment_terms_sha256": payment_hash,
                    "payment_terms": payment_terms,
                    "x402_version": raw.get("x402Version"),
                    "last_updated_claimed": raw.get("lastUpdated"),
                })
            except CensusError as exc:
                problems.append({"provider": provider, "index": idx, "reason": str(exc)})
    groups = []
    for identity, observations in sorted(indexed.items()):
        hashes = {o["payment_terms_sha256"] for o in observations}
        groups.append({"kind": identity[0], "resource": identity[1],
                       "tool_name": identity[2] or None,
                       "terms_conflict": len(hashes) > 1,
                       "observations": sorted(observations, key=lambda o: (o["provider"], o["index"]))})
    return {
        "source_spec": SOURCE_SPEC,
        "source_blob_sha": SOURCE_BLOB,
        "generated_at": utc_now(),
        "summary": {"facilitator_snapshots": len(snapshots),
                    "unique_resource_identities": len(groups),
                    "cross_facilitator_identities": sum(len({o["provider"] for o in g["observations"]}) > 1 for g in groups),
                    "conflicting_payment_identity_count": sum(g["terms_conflict"] for g in groups),
                    "rejected_records": len(problems)},
        "sources": provider_meta,
        "resources": groups,
        "diagnostics": problems,
        "verification_limits": "Listing terms are facilitator-supplied claims, not independently verified seller identity, live service availability, or ledger receipts. Conflicts are retained, not resolved."
    }


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CensusError("redirect_refused")


def _external_https_endpoint(raw: str) -> str:
    p = urlsplit(raw)
    if p.scheme != "https" or not p.hostname or p.username or p.password or p.fragment:
        raise CensusError("provider_endpoint_must_be_https")
    if p.port not in (None, 443):
        raise CensusError("non_default_https_port_refused")
    if re.search(r"%(?![0-9A-Fa-f]{2})", p.path):
        raise CensusError("provider_path_invalid_encoding")
    decoded_path = unquote(p.path)
    if ("\\" in decoded_path or "//" in decoded_path
            or any(ord(ch) < 32 or ord(ch) == 127 for ch in decoded_path)
            or any(part in (".", "..") for part in decoded_path.split("/"))):
        raise CensusError("provider_path_refused")
    endpoint_path = p.path.rstrip("/")
    if not endpoint_path:
        endpoint_path = "/discovery/resources"
    elif not endpoint_path.endswith("/discovery/resources"):
        endpoint_path += "/discovery/resources"
    try:
        static_query = parse_qsl(p.query, keep_blank_values=True, strict_parsing=True,
                                 max_num_fields=32)
    except ValueError as exc:
        raise CensusError("provider_query_invalid") from exc
    if any(not key or any(ord(ch) < 32 or ord(ch) == 127 for ch in key + value)
           for key, value in static_query):
        raise CensusError("provider_query_invalid")
    try:
        address = ipaddress.ip_address(p.hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise CensusError("non_public_address_refused")
    if p.hostname.lower() in ("localhost",) or p.hostname.lower().endswith((".local", ".internal")):
        raise CensusError("non_public_address_refused")
    # DNS is resolved just before each request. No discovered resource URI is fetched.
    try:
        addresses = socket.getaddrinfo(p.hostname, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise CensusError(f"provider_dns_error:{type(exc).__name__}") from exc
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise CensusError("provider_dns_not_public")
    return urlunsplit(("https", p.netloc.lower(), endpoint_path,
                       urlencode(static_query, doseq=True), ""))


def _page_url(endpoint: str, *, page_size: int, offset: int) -> str:
    p = urlsplit(endpoint)
    static_query = [(key, value) for key, value in parse_qsl(
        p.query, keep_blank_values=True, strict_parsing=True, max_num_fields=32
    ) if key.lower() not in ("limit", "offset")]
    static_query.extend((("limit", str(page_size)), ("offset", str(offset))))
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(static_query, doseq=True), ""))


def _get_json(url: str, *, timeout: float) -> tuple[bytes, object]:
    req = Request(url, method="GET", headers={"Accept": "application/json", "User-Agent": "PublicBazaarInterop/0.1"})
    try:
        with build_opener(_NoRedirect()).open(req, timeout=timeout) as response:
            if response.headers.get("Content-Length") and int(response.headers["Content-Length"]) > MAX_BYTES:
                raise CensusError("response_oversized")
            body = response.read(MAX_BYTES + 1)
    except (HTTPError, URLError, TimeoutError) as exc:
        raise CensusError(f"provider_get_failed:{type(exc).__name__}:{str(exc)[:120]}") from exc
    if len(body) > MAX_BYTES:
        raise CensusError("response_oversized")
    try:
        return body, json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CensusError("provider_invalid_json") from exc


def _probe(provider: str, raw_origin: str, *, page_size: int, timeout: float, evidence_dir: Path) -> list[dict]:
    if page_size < 1 or page_size > 1000:
        raise CensusError("page_size_must_be_1_to_1000")
    endpoint = _external_https_endpoint(raw_origin)
    evidence_dir.mkdir(parents=True, exist_ok=True)
    offset = 0
    seen_page_hashes = set()
    result = []
    while True:
        url = _page_url(endpoint, page_size=page_size, offset=offset)
        body, envelope = _get_json(url, timeout=timeout)
        sha = digest(body)
        if sha in seen_page_hashes:
            raise CensusError("repeated_page_detected_aborting_infinite_pagination")
        seen_page_hashes.add(sha)
        items = _resources(envelope)
        file_name = f"{provider}-{offset}-{sha[:16]}.json"
        path = evidence_dir / file_name
        path.write_bytes(body)  # preserve exact provider-response bytes
        result.append({"provider": provider, "endpoint": url, "retrieved_at": utc_now(),
                       "raw_sha256": sha, "raw_path": str(path), "data": envelope})
        offset += len(items)
        pagination = envelope.get("pagination", {}) if isinstance(envelope, dict) else {}
        if not items or len(items) < page_size or (isinstance(pagination, dict) and pagination.get("hasMore") is False):
            break
    return result


def _load_snapshot(path: str) -> dict:
    raw = Path(path).read_bytes()
    if len(raw) > MAX_BYTES:
        raise CensusError("snapshot_oversized")
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CensusError("snapshot_invalid_json") from exc
    # A full saved probe snapshot can be re-ingested without rewriting the bytes.
    if isinstance(obj, dict) and "data" in obj and "provider" in obj:
        data = obj["data"]
        provider = obj["provider"]
        endpoint = obj.get("endpoint")
    else:
        data = obj
        provider = Path(path).stem
        endpoint = None
    return {"provider": provider, "endpoint": endpoint, "retrieved_at": utc_now(),
            "raw_sha256": digest(raw), "data": data}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    cmd = parser.add_subparsers(dest="command", required=True)
    decode = cmd.add_parser("header", help="decode the official base64 EXTENSION-RESPONSES Bazaar catalog receipt")
    decode.add_argument("value")
    scan = cmd.add_parser("census", help="compare original offline responses and/or read-only actual public provider APIs")
    scan.add_argument("--snapshot", action="append", default=[], metavar="JSON_FILE")
    scan.add_argument("--provider", action="append", default=[], metavar="NAME=HTTPS_ENDPOINT")
    scan.add_argument("--output", required=True)
    scan.add_argument("--raw-dir", default="bazaar_raw_receipts")
    scan.add_argument("--page-size", type=int, default=100)
    scan.add_argument("--timeout", type=float, default=12)
    args = parser.parse_args(argv)
    try:
        if args.command == "header":
            print(json.dumps(decode_extension_responses(args.value), indent=2, sort_keys=True))
            return 0
        if not args.snapshot and not args.provider:
            raise CensusError("add_at_least_one_snapshot_or_provider")
        snapshots = [_load_snapshot(path) for path in args.snapshot]
        for entry in args.provider:
            if "=" not in entry:
                raise CensusError("provider_format_name_equals_https_endpoint")
            name, origin = entry.split("=", 1)
            if not name or not all(ch.isascii() and (ch.isalnum() or ch in "_-") for ch in name):
                raise CensusError("invalid_provider_name")
            snapshots.extend(_probe(name, origin, page_size=args.page_size, timeout=args.timeout,
                                    evidence_dir=Path(args.raw_dir)))
        output = census(snapshots)
        Path(args.output).write_text(json.dumps(output, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
        print(f"wrote {args.output}: {output['summary']}")
        return 0
    except (CensusError, OSError) as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

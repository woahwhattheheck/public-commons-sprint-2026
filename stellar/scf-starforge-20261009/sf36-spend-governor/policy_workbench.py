#!/usr/bin/env python3
"""Local SF36 policy authoring using the original governor policy validator.

No Governor instance, ledger access, secret key, signer, provider call or policy
installation. The browser downloads a separate operator-selected policy file.
"""
import argparse
import base64
import copy
import hashlib
import json
import pathlib
import sys
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from governor import CURRENCY_FIELDS, MAX_AMOUNT, NETWORKS, SCHEMA, validate_policy

MAX_SOURCE_BYTES = 1024 * 1024
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_ASSETS = 256
KNOWN_FIELDS = ("network", "asset", *CURRENCY_FIELDS)
DIRECTORY = pathlib.Path(__file__).resolve().parent


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON object keys must be resolved before editing")
        result[key] = value
    return result


def invalid_constant(_value):
    raise ValueError("Policy JSON cannot contain nonfinite numbers")


def decode_json(raw):
    return json.loads(raw.decode("utf-8-sig", errors="strict"),
                      object_pairs_hook=unique_object, parse_constant=invalid_constant,
                      parse_float=Decimal)


def encoded_json(value):
    # Original metadata may contain numbers more precise than binary floats.
    # Decimal values remain JSON numbers, never rounded or changed into strings.
    def encode(item, depth=0):
        if isinstance(item, dict):
            if not item:
                return "{}"
            rows = ["  " * (depth + 1) + json.dumps(key, ensure_ascii=True) + ": " + encode(entry, depth + 1)
                    for key, entry in item.items()]
            return "{\n" + ",\n".join(rows) + "\n" + "  " * depth + "}"
        if isinstance(item, list):
            if not item:
                return "[]"
            rows = ["  " * (depth + 1) + encode(entry, depth + 1) for entry in item]
            return "[\n" + ",\n".join(rows) + "\n" + "  " * depth + "]"
        if isinstance(item, Decimal):
            if not item.is_finite():
                raise ValueError("Policy JSON cannot contain nonfinite numbers")
            return str(item)
        return json.dumps(item, ensure_ascii=True, allow_nan=False)
    return (encode(value) + "\n").encode("utf-8")


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def source_policy(encoded):
    if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_SOURCE_BYTES + 2) // 3):
        raise ValueError("Policy source must be base64 JSON up to 1 MiB")
    raw = base64.b64decode(encoded, validate=True)
    if len(raw) > MAX_SOURCE_BYTES:
        raise ValueError("Policy source exceeds 1 MiB")
    policy = decode_json(raw)
    if (not isinstance(policy, dict) or policy.get("schema") != SCHEMA or
            not isinstance(policy.get("assets"), list) or len(policy["assets"]) > MAX_ASSETS or
            any(not isinstance(row, dict) for row in policy["assets"])):
        raise ValueError("Expected original SF36 policy schema with up to 256 asset objects")
    return raw, policy


def policy_validation(policy):
    try:
        validate_policy(policy)
    except (ValueError, TypeError, AttributeError) as error:
        return {"valid": False, "error": str(error)}
    return {"valid": True}


def bootstrap(encoded=None, name=None):
    source, rows = None, []
    validation = {"valid": False, "error": "Enter explicit network, asset and all five caps"}
    if encoded is not None:
        if (not isinstance(name, str) or not name or len(name) > 128 or
                "/" in name or "\\" in name or any(ord(char) < 32 for char in name)):
            raise ValueError("Policy filename must be a basename of at most 128 characters")
        raw, policy = source_policy(encoded)
        source = {"name": name, "sha256": sha256(raw), "base64": encoded}
        rows = [{"sourceIndex": index,
                 **{field: row.get(field) if isinstance(row.get(field), str) else ""
                    for field in KNOWN_FIELDS}}
                for index, row in enumerate(policy["assets"])]
        validation = policy_validation(policy)
    return {"schema": SCHEMA, "networks": sorted(NETWORKS),
            "fields": list(CURRENCY_FIELDS), "maxAmount": str(MAX_AMOUNT),
            "source": source, "rows": rows, "validation": validation}


def validate_edit(body):
    if not isinstance(body, dict) or set(body) != {"base64", "rows"}:
        raise ValueError("Supply original base64 (or null) and explicit rows")
    source_hash = None
    if body["base64"] is None:
        policy = {"schema": SCHEMA, "assets": []}
    else:
        raw, policy = source_policy(body["base64"])
        source_hash = sha256(raw)
    original_rows = policy["assets"]
    rows = body["rows"]
    if not isinstance(rows, list) or len(rows) > MAX_ASSETS:
        raise ValueError("Policy editor supports up to 256 explicit asset rows")
    seen_indices, updated = set(), []
    for number, row in enumerate(rows, start=1):
        if (not isinstance(row, dict) or set(row) != {"sourceIndex", *KNOWN_FIELDS} or
                any(not isinstance(row[field], str) or len(row[field]) > 256
                    for field in KNOWN_FIELDS)):
            raise ValueError(f"Asset row {number}: all known fields must be strings of at most 256 characters")
        index = row["sourceIndex"]
        if index is None:
            asset = {}
        else:
            if (type(index) is not int or index < 0 or index >= len(original_rows) or
                    index in seen_indices):
                raise ValueError(f"Asset row {number}: sourceIndex is duplicated or unavailable")
            seen_indices.add(index)
            asset = copy.deepcopy(original_rows[index])
        asset.update({field: row[field] for field in KNOWN_FIELDS})
        updated.append(asset)
    policy = copy.deepcopy(policy)
    policy["assets"] = updated
    # This is the existing policy contract, not another budget or authority engine.
    validate_policy(policy)
    raw = encoded_json(policy)
    if len(raw) > MAX_SOURCE_BYTES:
        raise ValueError("Edited policy exceeds 1 MiB")
    return {"valid": True, "policyText": raw.decode("utf-8"), "sha256": sha256(raw),
            "sourceSha256": source_hash, "assetCount": len(updated)}


def create_server(*, policy_path=None, port=0):
    if type(port) is not int or not 0 <= port <= 65535:
        raise ValueError("Port must be in 0–65535")
    if policy_path is None:
        initial = bootstrap()
    else:
        selected = pathlib.Path(policy_path)
        if not selected.is_file():
            raise ValueError("Policy path must name a regular JSON file")
        with selected.open("rb") as stream:
            raw = stream.read(MAX_SOURCE_BYTES + 1)
        if len(raw) > MAX_SOURCE_BYTES:
            raise ValueError("Policy source exceeds 1 MiB")
        initial = bootstrap(base64.b64encode(raw).decode("ascii"), selected.name)
    # Retain the exact selected startup snapshot; do not reread or install files
    # in response to browser input. Edits and imports are request-local values.
    page = (DIRECTORY / "policy-editor.html").read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            return

        def respond(self, status, value, content_type="application/json; charset=utf-8"):
            data = value if isinstance(value, bytes) else encoded_json(value)
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == "/":
                self.respond(200, page, "text/html; charset=utf-8")
            elif path == "/api/bootstrap":
                self.respond(200, initial)
            else:
                self.respond(404, {"valid": False, "error": "Not found"})

        def do_POST(self):
            path = urlsplit(self.path).path
            if path not in ("/api/load", "/api/validate"):
                self.respond(404, {"valid": False, "error": "Not found"})
                return
            try:
                if self.headers.get("Transfer-Encoding") is not None:
                    raise ValueError("Use a bounded JSON request with Content-Length")
                lengths = self.headers.get_all("Content-Length", [])
                if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdecimal():
                    raise ValueError("A single JSON Content-Length is required")
                length = int(lengths[0])
                if not 1 <= length <= MAX_REQUEST_BYTES:
                    raise ValueError("Request must contain 1 byte to 2 MiB of JSON")
                self.connection.settimeout(10)
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError("Incomplete JSON request")
                body = decode_json(raw)
                if path == "/api/load":
                    if not isinstance(body, dict) or set(body) != {"name", "base64"}:
                        raise ValueError("Load requires a filename and original base64 bytes")
                    result = bootstrap(body["base64"], body["name"])
                else:
                    result = validate_edit(body)
                self.respond(200, result)
            except (ValueError, TypeError, AttributeError, UnicodeError, RecursionError, OSError) as error:
                self.respond(400, {"valid": False, "error": str(error)[:300]})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", help="Optional existing policy JSON to edit; no example is loaded by default")
    parser.add_argument("--port", type=int, default=8788, help="Loopback port; use 0 for an available port")
    args = parser.parse_args(argv)
    server = create_server(policy_path=args.policy, port=args.port)
    print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}",
                      "mode": "POLICY_AUTHORING_ONLY", "policyInstalled": False}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, TypeError, RecursionError) as error:
        print(f"POLICY_WORKBENCH_ERROR: {error}", file=sys.stderr)
        sys.exit(2)

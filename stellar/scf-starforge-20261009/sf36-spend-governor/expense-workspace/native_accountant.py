"""Fixed source-owned accountant-return validation; no network or book write."""
from pathlib import Path
import base64
import hashlib
import json
import re
import subprocess
from domain import Problem
from native_mcp import node_path
from native_woo import source_root

LIMIT = 64 * 1024 * 1024
READER = "stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/buyer-return-cli.mjs"


def return_bytes(payload):
    raw = payload.get("content_base64")
    if not isinstance(raw, str) or len(raw) > (LIMIT * 4 // 3) + 4:
        raise Problem("ACCOUNTANT_RETURN_SIZE", "Choose an original buyer-return JSON file up to 64 MiB")
    try:
        data = base64.b64decode(raw, validate=True)
    except ValueError as exc:
        raise Problem("ACCOUNTANT_RETURN_FILE", "Choose the original complete accountant return") from exc
    if not data or len(data) > LIMIT or base64.b64encode(data).decode() != raw:
        raise Problem("ACCOUNTANT_RETURN_FILE", "Choose the original complete accountant return")
    if hashlib.sha256(data).hexdigest() != payload.get("sha256"):
        raise Problem("ACCOUNTANT_RETURN_CHANGED", "The returned file differs from the reviewed SHA-256", 409)
    return data


def inspect_return(source_bytes, packet_bytes, node=None):
    reader = source_root() / READER
    if reader.is_symlink() or not reader.is_file():
        raise Problem("ACCOUNTANT_READER_MISSING", "Use the original installed buyer accountant-return reader", 409)
    request = {"buyerSourceBase64": base64.b64encode(source_bytes).decode(),
               "packetBase64": base64.b64encode(packet_bytes).decode()}
    result = subprocess.run([node_path(node), str(reader)], input=json.dumps(request, separators=(",", ":")).encode(),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=False)
    if result.returncode:
        try:
            error = json.loads(result.stderr).get("error", {})
        except (ValueError, UnicodeError):
            error = {}
        raise Problem(error.get("code", "ACCOUNTANT_RETURN_REJECTED"),
                      error.get("message", "The original accountant engine rejected this returned packet"),
                      error.get("status", 422))
    try:
        value = json.loads(result.stdout)
        if (value["schema"] != "stellar-forge.buyer-accountant-return-inspection.v1"
                or value["source"]["sha256"] != hashlib.sha256(source_bytes).hexdigest()
                or value["packetSha256"] != hashlib.sha256(packet_bytes).hexdigest()
                or not isinstance(value["rows"], list) or not isinstance(value["revisions"], list)):
            raise ValueError()
    except (ValueError, KeyError, TypeError) as exc:
        raise Problem("ACCOUNTANT_RETURN_FORMAT", "The native reader did not return the complete original source identity", 422) from exc
    return value

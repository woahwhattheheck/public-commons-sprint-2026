#!/usr/bin/env python3
"""Complete an application with its exact selected original source dependencies.

Reuse matching files from an existing application first; optional HTTPS receiving
uses the source URI and exact byte/SHA256 identity declared in the source map.
The completed source goes to a new directory or an identical previous receive.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import urllib.parse
import urllib.request

from application_assembly import (canonical, compose, layer_from_document,
    local_dependencies, member_name, publish_file, read_layer,
    receive_directory, source_receipt, write_archive)


def original_bytes(record, roots, allow_download):
    name = str(member_name(record["path"]))
    expected_size, expected_hash = record.get("bytes"), record.get("sha256")
    if (type(expected_size) is not int or not 0 <= expected_size <= 64 * 1024 * 1024
            or not isinstance(expected_hash, str) or len(expected_hash) != 64
            or any(char not in "0123456789abcdef" for char in expected_hash)):
        raise ValueError("Choose the declared original source identity: " + name)
    attempts = []

    def check(body):
        if len(body) != expected_size or hashlib.sha256(body).hexdigest() != expected_hash:
            raise ValueError("Original source identity differs: " + name)
        return body

    for root in roots:
        candidate = root / name
        try:
            resolved = candidate.resolve(strict=True)
            if not resolved.is_relative_to(root) or not resolved.is_file():
                raise ValueError("Source member must remain inside the selected original application")
            if resolved.stat().st_size != expected_size:
                raise ValueError("Original source byte count differs")
            return check(resolved.read_bytes()), {"kind": "retained_application", "path": str(resolved)}
        except (OSError, ValueError) as error:
            attempts.append({"source": str(candidate), "error": str(error)})
    uri = record.get("source_uri")
    if allow_download and isinstance(uri, str):
        url = urllib.parse.urlsplit(uri)
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("The original source URI must be an HTTPS document URL")
        request = urllib.request.Request(uri, headers={"User-Agent": "Upper-Savannah-Source-Receiver/1"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                if urllib.parse.urlsplit(response.geturl()).scheme != "https":
                    raise ValueError("Original source receiving redirected away from HTTPS")
                body = response.read(expected_size + 1)
            return check(body), {"kind": "original_https", "source_uri": uri}
        except (OSError, ValueError) as error:
            attempts.append({"source": uri, "error": str(error)})
    raise ValueError("Original source receiving failed: " +
                     json.dumps({"path": name, "attempts": attempts}, ensure_ascii=False))


def complete(source, members, roots, allow_download, edition, operation_id):
    base = read_layer(source)
    declared = {row["path"]: row for row in base.document.get("external_sources", [])
                if isinstance(row, dict) and isinstance(row.get("path"), str)}
    selected = list(dict.fromkeys(str(member_name(name)) for name in members))
    if not selected:
        raise ValueError("Select at least one declared original source member")
    entries, received = [], []
    for name in selected:
        if name in base.files:
            received.append({"path": name, "state": "already_embedded",
                             "sha256": base.metadata[name]["sha256"]})
            continue
        if name not in declared:
            raise ValueError("The application does not declare this external source: " + name)
        record = declared[name]
        body, origin = original_bytes(record, roots, allow_download)
        text = body.decode("utf-8")
        if text.encode("utf-8") != body:
            raise ValueError("Application source must retain exact UTF-8 text: " + name)
        entries.append({"path": name, "content": text, "bytes": len(body),
                        "sha256": record["sha256"], "mode": record.get("mode", "100644")})
        received.append({"path": name, "state": "original_received",
                         "sha256": record["sha256"], "bytes": len(body), "origin": origin})
    layers = [base]
    if entries:
        document = {"schema": "commons.source-bank/v1",
                    "source_ref": "selected original application dependencies", "files": entries}
        layers.append(layer_from_document(document))
    document = compose(layers, edition=edition, operation_id=operation_id)
    dependencies = local_dependencies(document)
    if dependencies["missing"] or dependencies["syntax_errors"]:
        raise ValueError("Complete the remaining original application imports before receiving: " +
                         json.dumps(dependencies, ensure_ascii=False))
    return document, received, dependencies


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="The complete original application source carrier")
    parser.add_argument("--member", action="append", required=True,
                        help="Declared original application source path; repeat for selected members")
    parser.add_argument("--source-root", action="append", type=Path, default=[],
                        help="Existing original application directory to search before HTTPS")
    parser.add_argument("--allow-download", action="store_true",
                        help="Receive selected missing originals from their declared HTTPS source URIs")
    parser.add_argument("--edition", required=True)
    parser.add_argument("--operation-id")
    parser.add_argument("--output", type=Path, help="New or identical received application directory")
    parser.add_argument("--source-map", type=Path, help="Write the completed full source map")
    parser.add_argument("--zip", dest="archive_path", type=Path)
    args = parser.parse_args(argv)
    if not (args.output or args.source_map or args.archive_path):
        parser.error("Choose --output, --source-map or --zip")
    try:
        roots = [root.expanduser().resolve(strict=True) for root in args.source_root]
        if any(not root.is_dir() for root in roots):
            raise ValueError("Every original source root must be an existing application directory")
        document, received, dependencies = complete(
            args.source, args.member, roots, args.allow_download, args.edition, args.operation_id)
        payload = canonical(document)
        receipt = source_receipt(document, payload)
        result = {**receipt, "original_source_receiving": received,
                  "local_dependencies": dependencies, "edition": args.edition}
        if args.source_map:
            result["source_map"] = publish_file(args.source_map, payload)
        if args.output:
            result["received"] = receive_directory(args.output, document, receipt)
        if args.archive_path:
            result["archive"] = write_archive(args.archive_path, document, receipt)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, TypeError, KeyError, UnicodeError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__, "message": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

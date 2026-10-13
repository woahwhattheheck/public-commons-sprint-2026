"""Receive the complete Upper Savannah decision companion into a product directory.

Usage: python -B receive_decision_source.py decision-source.json PRODUCT_DIRECTORY
The source may also be the downloaded source-pack HTML from the shared Page.
"""
from __future__ import annotations
import argparse
import base64
import binascii
import gzip
import io
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import sys


class _SourceHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("id") == "decision-source-files":
            self.active = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)


def receive(source, destination):
    text = Path(source).read_text(encoding="utf-8")
    if text.lstrip().startswith("<"):
        parser = _SourceHTML()
        parser.feed(text)
        text = "".join(parser.parts)
        if not text:
            raise ValueError("The HTML does not contain the decision source package")
    package = json.loads(text)
    if package.get("schema") == "upstate.decision-source-carrier/v1":
        if package.get("encoding") != "gzip+base64":
            raise ValueError("Unsupported decision source carrier encoding")
        try:
            compressed = base64.b64decode(package["data"], validate=True)
        except (binascii.Error, ValueError, TypeError) as error:
            raise ValueError("The source carrier has invalid base64") from error
        if (len(compressed) != package["compressed_bytes"] or
                hashlib.sha256(compressed).hexdigest() != package["compressed_sha256"]):
            raise ValueError("The compressed source differs from its manifest")
        expected_bytes = package["payload_bytes"]
        if type(expected_bytes) is not int or not 0 < expected_bytes <= 64 * 1024 * 1024:
            raise ValueError("The source carrier declares an invalid decoded size")
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            decoded = stream.read(expected_bytes + 1)
        if (len(decoded) != expected_bytes or
                hashlib.sha256(decoded).hexdigest() != package["payload_sha256"]):
            raise ValueError("The decoded source differs from its manifest")
        package = json.loads(decoded.decode("utf-8"))
    if package.get("schema") != "upstate.decision-source/v1":
        raise ValueError("Select the complete upstate.decision-source/v1 package")
    root = Path(destination).resolve()
    planned, seen = [], set()
    for entry in package["files"]:
        name = entry["path"]
        relative = PurePosixPath(name)
        if not name or "\\" in name or ":" in name or relative.is_absolute() or any(
                p in ("..", ".") for p in relative.parts):
            raise ValueError("Invalid source member path: " + name)
        target = root.joinpath(*relative.parts).resolve()
        if not target.is_relative_to(root) or target == root or target in seen:
            raise ValueError("Source member leaves the product or is repeated: " + name)
        seen.add(target)
        body = entry["content"].encode("utf-8")
        if len(body) != entry["bytes"] or hashlib.sha256(body).hexdigest() != entry["sha256"]:
            raise ValueError("Source member differs from its manifest: " + name)
        if target.exists() and (not target.is_file() or target.read_bytes() != body):
            raise ValueError("Existing source differs; reconcile it before receiving: " + str(target))
        planned.append((target, body))
    for target, body in planned:
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as stream:
                stream.write(body)
    return {"operation": package["operation"], "directory": str(root),
            "files": len(planned), "source_bytes": sum(len(body) for _, body in planned)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()
    try:
        print(json.dumps(receive(args.source, args.destination), indent=2))
    except (ValueError, OSError, KeyError, TypeError, EOFError) as error:
        print(str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

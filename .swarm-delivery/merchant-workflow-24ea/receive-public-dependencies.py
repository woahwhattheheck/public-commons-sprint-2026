#!/usr/bin/env python3
"""Receive the two original public packages for the existing merchant operation."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", required=True, help="Owned complete JSON source destination")
parser.add_argument("--transfers", help="Private JSON array with fresh retained metadataUrl/archiveUrl pairs")
args = parser.parse_args()
operation = "ASTRA-24EA-MERCHANT-WORKFLOW-20261012"
expected = {"yaml": ("2.9.1", 112114), "re2js": ("2.8.6", 213596)}
transfers = json.loads(Path(args.transfers).read_bytes()) if args.transfers else [
    {"name": name, "metadataUrl": "https://registry.npmjs.org/" + name + "/" + version}
    for name, (version, _) in expected.items()
]
if len(transfers) != 2 or {item["name"] for item in transfers} != set(expected):
    raise RuntimeError("Receive the two original complete package sources.")

def receive(url):
    if not url.startswith("https://"):
        raise RuntimeError("Use the original public HTTPS package source.")
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()

packages = []
for selected in transfers:
    name = selected["name"]
    version, size = expected[name]
    metadata_bytes = receive(selected["metadataUrl"])
    metadata = json.loads(metadata_bytes)
    if metadata.get("name") != name or metadata.get("version") != version:
        raise RuntimeError("Retain the selected original npm metadata: " + name)
    archive_bytes = receive(selected.get("archiveUrl") or metadata["dist"]["tarball"])
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(archive_bytes).digest()).decode()
    if len(archive_bytes) != size or metadata["dist"]["integrity"] != integrity:
        raise RuntimeError("Retain the unchanged original npm archive: " + name)
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
        manifest = json.load(archive.extractfile("package/package.json"))
    if manifest.get("name") != name or manifest.get("version") != version or manifest.get("dependencies"):
        raise RuntimeError("Retain the complete original dependency-free package: " + name)
    packages.append({
        "name": name, "version": version, "license": manifest.get("license"),
        "metadataBytes": len(metadata_bytes), "metadataSha256": hashlib.sha256(metadata_bytes).hexdigest(),
        "metadataText": metadata_bytes.decode("utf-8"), "archiveBytes": len(archive_bytes),
        "archiveSha256": hashlib.sha256(archive_bytes).hexdigest(), "integrity": integrity,
        "archiveBase64": base64.b64encode(archive_bytes).decode()
    })
document = json.dumps({"schema": "commons.original-public-npm-archives.v1", "operationId": operation,
                       "packages": packages}, ensure_ascii=True, indent=2) + "\n"
data = document.encode("ascii")
destination = Path(args.output).resolve()
destination.parent.mkdir(parents=True, exist_ok=True)
if destination.exists():
    if destination.read_bytes() != data:
        raise RuntimeError("Keep the existing original dependency capsule: " + str(destination))
else:
    pending = destination.with_name(destination.name + "." + str(os.getpid()) + ".pending")
    with pending.open("xb") as output:
        os.chmod(pending, 0o600)
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    os.replace(pending, destination)
print(json.dumps({"event": "DEPENDENCY_SOURCE_READY", "operationId": operation, "path": str(destination),
                  "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                  "blobSha": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest(),
                  "packages": [{key: package[key] for key in
                      ("name", "version", "license", "archiveBytes", "archiveSha256", "metadataSha256", "integrity")}
                      for package in packages]}), flush=True)

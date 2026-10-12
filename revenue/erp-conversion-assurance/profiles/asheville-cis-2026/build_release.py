#!/usr/bin/env python3
"""MIT. Build and verify the complete source-only Asheville operator capsule."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

SOURCE_FILES = [
    "LICENSE",
    "revenue/erp-conversion-assurance/README.md",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/INSTALL.md",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/NATIVE_FORMATS.md",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/OPERATOR.md",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/README.md",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/archive.py",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/backup.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/billing-rules.json",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/billing.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/browser_journey.py",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/build_release.py",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/cli.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/collections.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/continue-practice.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/engine.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/extension.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/ezreader-contracts.json",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/ezreader.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/field.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/munibilling-import-contracts.json",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/munibilling-native-contracts.json",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/munibilling.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/package.py",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/panel.css",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/panel.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/payments.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/practice.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/profile.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/store.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/templates.mjs",
    "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/util.mjs",
    "revenue/erp-conversion-assurance/profiles/scap-rfp-2027/README.md",
    "revenue/erp-conversion-assurance/profiles/scap-rfp-2027/profile.mjs",
    "revenue/erp-conversion-assurance/reconcile.mjs",
    "revenue/erp-conversion-assurance/scap-workspace/README.md",
    "revenue/erp-conversion-assurance/scap-workspace/app.mjs",
    "revenue/erp-conversion-assurance/scap-workspace/cli.mjs",
    "revenue/erp-conversion-assurance/scap-workspace/index.html",
    "revenue/erp-conversion-assurance/scap-workspace/mapping.mjs",
    "revenue/erp-conversion-assurance/scap-workspace/model.mjs",
    "revenue/erp-conversion-assurance/scap-workspace/server.mjs",
    "revenue/erp-conversion-assurance/scap-workspace/style.css",
    "revenue/erp-conversion-assurance/service/README.md",
    "revenue/erp-conversion-assurance/service/job-worker.mjs",
    "revenue/erp-conversion-assurance/service/operator.mjs",
    "revenue/erp-conversion-assurance/service/service.mjs",
    "stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs"
]
PROFILE = "revenue/erp-conversion-assurance/profiles/asheville-cis-2026/"
SCHEMA = "asheville.utility-source.v1"

def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

def identity(name, body):
    return {
        "path": name,
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "gitBlobSha": hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest(),
    }

def start_here():
    return ("""# Asheville utility conversion operator

This archive is a complete local application source closure. Its named sources,
license and exact content hashes are in SOURCE_MANIFEST.json. Project databases,
customer exports, credentials, browser profiles and operation results are never
included by the builder.

## Start the application

Use the existing Linux Node 22.16+ runtime with builtin node:sqlite, Python 3,
tar and flock. No npm or pip install is required for the application itself.

~~~bash
node """ + PROFILE + """cli.mjs serve --directory /absolute/private/utility-workspace
~~~

Open the private URL printed by the command. Create the project in the operator,
retain original exports, review the mapping and follow the native billing,
payment, field and delivery workflow. Keep the complete archive directory layout.

## Operator guides

- [Installation](""" + PROFILE + """INSTALL.md)
- [Full operating workflow](""" + PROFILE + """OPERATOR.md)
- [Native format contracts](""" + PROFILE + """NATIVE_FORMATS.md)
- [Application overview](""" + PROFILE + """README.md)

## Complete generated Practice

Run from this extraction root. The operation directory must be new.

~~~bash
node """ + PROFILE + """practice.mjs /absolute/new/private/practice-operation
~~~

Add --browser only when Python Playwright and Chromium already exist in the
runtime. The driver uses those native tools against its own local application.
UTILITY_PYTHON and UTILITY_CHROMIUM may select existing executable paths.
The original operation writes its actual phase checkpoints and outcome in
result.json; this source archive does not assert a particular execution result.

The Practice carries the 5,000-account billing/correction/adoption operation,
native source formats, payment returns, field photographs, full handoff and
original-path cold restoration. Published source rules are separate from the
generated Practice identities.

## Rebuild the same source capsule

~~~bash
python3 """ + PROFILE + """build_release.py --source-root . --output /absolute/new/operator.zip --source-reference release-identifier
python3 """ + PROFILE + """build_release.py --verify /absolute/new/operator.zip
~~~

The source reference is the release label provided by the packager; each file's
hash identifies its actual included bytes. Repeated builds with identical sources and the same label in the same
Python/zlib runtime produce an identical archive. Choose a new output path; existing artifacts are
preserved. The builder includes only its enumerated application source files.

The City's CIS RFI is information-only. Production configuration, import
acceptance and operating authority belong to the actual receiving project.
""").encode("utf-8")

def verify_capsule(filename):
    with zipfile.ZipFile(filename, "r") as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("The archive contains repeated member names.")
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name or str(path) != name:
                raise ValueError("The archive has an unsafe or noncanonical member path.")
        manifest = json.loads(archive.read("SOURCE_MANIFEST.json"))
        if manifest.get("schema") != SCHEMA or not isinstance(manifest.get("files"), list):
            raise ValueError("Choose an Asheville source capsule produced by this builder.")
        records = manifest["files"]
        paths = [entry["path"] for entry in records]
        if len(paths) != len(set(paths)) or set(names) != set(paths + ["SOURCE_MANIFEST.json", "START_HERE.md"]):
            raise ValueError("The archive's exact source inventory differs from its manifest.")
        for entry in records:
            if identity(entry["path"], archive.read(entry["path"])) != entry:
                raise ValueError("The archived source differs from its content identity: " + entry["path"])
        if identity("START_HERE.md", archive.read("START_HERE.md")) != manifest.get("entryPoint"):
            raise ValueError("The startup guide differs from its declared content identity.")
        if manifest.get("sourceFiles") != len(records):
            raise ValueError("The manifest source count differs from its exact records.")
    body = Path(filename).read_bytes()
    return {"archive": str(Path(filename).resolve()), "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(), "sourceFiles": len(records),
            "sourceBytes": sum(entry["bytes"] for entry in records),
            "sourceReference": manifest["sourceReference"], "verified": True}

def build_capsule(source_root, output, source_reference):
    root = Path(source_root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Choose the complete repository or extracted source root.")
    output = Path(output).absolute()
    if output.suffix.lower() != ".zip":
        raise ValueError("Choose a .zip output filename.")
    if output.exists() or output.is_symlink():
        raise FileExistsError("An output artifact already exists; choose a new output filename.")
    output.parent.mkdir(parents=True, exist_ok=True)
    bodies = {}
    for name in SOURCE_FILES:
        source = root / name
        resolved = source.resolve(strict=True)
        if source.is_symlink() or not resolved.is_relative_to(root) or not source.is_file():
            raise ValueError("The named source must be a regular file inside the source root: " + name)
        bodies[name] = source.read_bytes()
    records = [identity(name, body) for name, body in bodies.items()]
    guide = start_here()
    manifest = {"schema": SCHEMA,
                "repository": "woahwhattheheck/public-commons-sprint-2026",
                "sourceReference": source_reference,
                "sourceFiles": len(records),
                "entryPoint": identity("START_HERE.md", guide),
                "contents": "Enumerated public application sources; no private operating workspace.",
                "files": records}
    fd, temporary_name = tempfile.mkstemp(prefix=".asheville-source-", suffix=".zip", dir=output.parent)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        members = {**bodies, "SOURCE_MANIFEST.json": encode(manifest), "START_HERE.md": guide}
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name in sorted(members):
                item = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                item.create_system = 3
                item.external_attr = 0o100644 << 16
                item.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(item, members[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
        verify_capsule(temporary)
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        os.link(temporary, output)
        fd = os.open(output.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        return verify_capsule(output)
    finally:
        temporary.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", default=str(Path(__file__).resolve().parents[4]))
    parser.add_argument("--output")
    parser.add_argument("--source-reference", default="working-source")
    parser.add_argument("--verify", metavar="ARCHIVE")
    args = parser.parse_args()
    if args.verify:
        if args.output:
            parser.error("Choose verification or a new build output.")
        result = verify_capsule(args.verify)
    else:
        if not args.output:
            parser.error("--output is required to build the complete capsule.")
        result = build_capsule(args.source_root, args.output, args.source_reference)
    print(json.dumps(result))

if __name__ == "__main__":
    main()

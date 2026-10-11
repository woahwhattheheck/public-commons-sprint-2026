#!/usr/bin/env python3
"""Build the complete maintained CSKT delivery from its explicit public file list."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = [
    ".gitignore", "README.md", "OPERATIONS.md", "package.json", "cli.mjs",
    "capture-source.py", "assemble-source.py", "package-source.py",
    "preflight.mjs", "observed-public-content.json", "preflight-report.json",
    "src/core.mjs", "src/store.mjs", "src/server.mjs",
    "public/index.html", "public/styles.css", "public/app.mjs",
    "destination/wordpress.mjs", "destination/cli.mjs",
    "destination/DEPLOYMENT.md", "destination/WORDPRESS.md",
    "destination/wordpress-plugin/cskt-migration.php",
    "destination/wordpress-plugin/state.php",
    "destination/wordpress-plugin/release.php",
    "destination/wordpress-plugin/uploads.php",
    "destination/wordpress-plugin/public.php",
    "source/CONTRACT.md", "source/maintained-source.json",
    "source/source-index.json", "source/source-links.json",
    "source/html-source-index.json", "source/page-completeness.json",
    "source/capture-summary.json", "source/requirements.json",
    "source/video-size-catalog.json",
    "commercial/WORKSHARE.md", "commercial/ACCEPTANCE.md",
    "commercial/quote.json", "commercial/build_proposal.py",
    "commercial/CSKT_DEWR_Content_GIS_Workshare.pdf",
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="Destination ZIP path.")
    parser.add_argument("--commit", help="The 40-character Git commit containing this source.")
    args = parser.parse_args()
    if args.commit and not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        parser.error("--commit must be a complete lowercase Git commit SHA.")
    output = args.output.resolve()
    selected = [(name, ROOT / name) for name in sorted(FILES)]
    if any(path.is_symlink() or not path.is_file() for _, path in selected):
        missing = [name for name, path in selected if path.is_symlink() or not path.is_file()]
        parser.error("Missing or linked maintained source: " + ", ".join(missing))
    if output in {path.resolve() for _, path in selected}:
        parser.error("The archive must have its own output path.")
    members = []
    bodies = []
    for name, path in selected:
        body = path.read_bytes()
        members.append({"path": name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})
        bodies.append((name, body))
    manifest = {
        "schema": "cskt.maintained-source-delivery.v1",
        "repository": "woahwhattheheck/public-commons-sprint-2026",
        "repositoryPath": "business/cskt-dewr-migration-20261011",
        "commit": args.commit,
        "entrypoint": "cli.mjs",
        "operations": "OPERATIONS.md",
        "destinationGuide": "destination/DEPLOYMENT.md",
        "sourceContract": "source/CONTRACT.md",
        "members": members,
    }
    bodies.append(("DELIVERY.json", (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode()))
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".partial")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, body in bodies:
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, body)
        with zipfile.ZipFile(temporary) as archive:
            if archive.namelist() != [name for name, _ in bodies]:
                raise RuntimeError("The archive's member order differs from the source selection.")
            for name, body in bodies:
                if archive.read(name) != body:
                    raise RuntimeError("Archive content differs from the selected source: " + name)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    digest = hashlib.sha256()
    with output.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    print(json.dumps({
        "output": str(output), "bytes": output.stat().st_size,
        "sha256": digest.hexdigest(), "members": len(bodies), "commit": args.commit,
    }))

if __name__ == "__main__":
    main()

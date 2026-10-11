#!/usr/bin/env python3
"""Create one complete portable operator archive from the shared source checkout."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
DIRECTORIES = ("bi_operator", "web", "vendor", "schemas", "examples", "tools")
TOP_LEVEL = (
    "BI_OPERATOR.py", "prepare_project.py", "OPEN_POWER_BI.ps1",
    "build_release.py", "requirements.txt", "README.md", "OPERATOR_GUIDE.md",
    "THIRD_PARTY_LICENSES.txt", "VENDOR_SOURCE.json",
)


def included_files():
    files = [ROOT / name for name in TOP_LEVEL]
    for directory in DIRECTORIES:
        files += [path for path in (ROOT / directory).rglob("*") if path.is_file()
                  and "__pycache__" not in path.parts and path.suffix != ".pyc"
                  and not path.name.endswith(".bi-backup")]
    # The six complete CSV files are already contained in examples/sandag/data.zip.
    return sorted({p for p in files if p.is_file()
                   and not (p.suffix == ".csv" and "examples" in p.parts)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-commit", default="")
    args = parser.parse_args()
    output = Path(args.output).expanduser().resolve()
    if output.exists():
        raise SystemExit("Choose a new output filename; an existing delivery is not overwritten.")
    files = included_files()
    required = [ROOT / p for p in TOP_LEVEL] + [ROOT / "examples/sandag/data.zip"]
    missing = [str(p.relative_to(ROOT)) for p in required if not p.is_file()]
    if missing:
        raise SystemExit("Missing source files: " + ", ".join(missing))
    manifest = {
        "format": "commons-bi-operator-release/1",
        "version": "1.0.0",
        "source_commit": args.source_commit,
        "files": [{"path": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size,
                   "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for path in files:
            info = zipfile.ZipInfo("Commons-BI-Operator/" + path.relative_to(ROOT).as_posix(),
                                   date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            package.writestr(info, path.read_bytes())
        package.writestr("Commons-BI-Operator/RELEASE.json",
                         json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    with zipfile.ZipFile(output) as package:
        for item in manifest["files"]:
            actual = package.read("Commons-BI-Operator/" + item["path"])
            if len(actual) != item["bytes"] or hashlib.sha256(actual).hexdigest() != item["sha256"]:
                raise SystemExit("Release readback differed: " + item["path"])
    print(json.dumps({"path": str(output), "files": len(files),
        "bytes": output.stat().st_size, "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "source_commit": args.source_commit}, indent=2))


if __name__ == "__main__":
    main()

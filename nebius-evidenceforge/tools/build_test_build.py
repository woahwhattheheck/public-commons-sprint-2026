"""Build the complete original application with explicitly selected native runs."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from evidenceforge.retained_runs import download_bundle, read_operation


def source_files():
    files = {}
    paths = list(ROOT.glob("*.md")) + [ROOT / "launch.py", ROOT / "pyproject.toml"]
    for directory, suffixes in (
        ("evidenceforge", {".py", ".html", ".js", ".css"}),
        ("tests", {".py"}),
        ("tools", {".py"}),
        ("demo", {".json"}),
        ("evidence", {".json"}),
    ):
        paths.extend(p for p in (ROOT / directory).rglob("*")
                     if p.suffix in suffixes and "__pycache__" not in p.parts)
    for path in sorted(paths):
        relative = path.relative_to(ROOT)
        if not stat.S_ISREG(path.lstat().st_mode) or path.is_symlink():
            raise ValueError(f"Source member is not a regular file: {relative}")
        if any(ROOT.joinpath(*relative.parts[:i]).is_symlink()
               for i in range(1, len(relative.parts))):
            raise ValueError("Source member has a linked parent")
        files[relative.as_posix()] = path.read_bytes()
    license_path = ROOT / "LICENSE"
    if not license_path.is_file():
        license_path = ROOT.parent / "LICENSE"
    if not license_path.is_file() or license_path.is_symlink():
        raise ValueError("The original repository LICENSE must accompany the build")
    files["LICENSE"] = license_path.read_bytes()
    return files


def selected_runs(root, identities):
    files, summaries = {}, []
    for identity in identities:
        operation = read_operation(root, identity)
        if not operation["result_verified"]:
            raise ValueError(f"Operation does not contain a completed native result: {identity}")
        raw = download_bundle(root, identity)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError("Native run bundle contains duplicate members")
            for name in names:
                path = Path(name)
                if path.is_absolute() or ".." in path.parts or "\\" in name:
                    raise ValueError("Native run member has an invalid path")
                if name.startswith(identity + "/"):
                    destination = "example-runs/" + name
                elif name in {"delivery.json", "OPEN.md"}:
                    destination = f"example-runs/{identity}-{name}"
                else:
                    raise ValueError("Unexpected native run member")
                files[destination] = archive.read(name)
        run = operation["run"]
        summaries.append({
            "operation_id": identity,
            "task_id": run["task_id"],
            "qualifying_nebius_runtime_observed": run.get("qualifying_nebius_runtime_observed", False),
            "run_sha256": run["run_sha256"],
        })
    return files, summaries


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--runs", type=Path)
    parser.add_argument("--include-operation", action="append", default=[])
    args = parser.parse_args(argv)
    if args.include_operation and args.runs is None:
        parser.error("--runs is required when including an operation")
    if len(args.include_operation) != len(set(args.include_operation)):
        parser.error("Each included operation must be named once")
    files = source_files()
    run_files, operations = selected_runs(args.runs, args.include_operation)
    files.update(run_files)
    info = {
        "schema": "evidenceforge-test-build/v1",
        "entrypoint": "python -B launch.py --runs ./example-runs --port 8081",
        "python": ">=3.11",
        "retained_operations": operations,
        "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                  for name, data in sorted(files.items())},
    }
    files["BUILD_INFO.json"] = (json.dumps(info, indent=2, sort_keys=True) + "\n").encode()
    output = args.output.absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as stream:
        try:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name, data in sorted(files.items()):
                    entry = zipfile.ZipInfo("EvidenceForge/" + name)
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    entry.external_attr = 0o100644 << 16
                    archive.writestr(entry, data)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            output.unlink(missing_ok=True)
            raise
    with output.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    print(json.dumps({"path": str(output), "bytes": output.stat().st_size,
                      "sha256": digest, "files": len(files), "operations": operations}))


if __name__ == "__main__":
    main()

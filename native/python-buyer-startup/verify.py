#!/usr/bin/env python3
"""Run the original Python buyer public API against its exact facade predecessor."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
from datetime import datetime, timezone

PHASE = "import importlib,json,os,pathlib,pickle,resource,sys,tempfile,time\npackage_root=pathlib.Path(sys.argv[1]);mode=sys.argv[2];expect=json.loads(pathlib.Path(sys.argv[3]).read_text())\nsys.path.insert(0,str(package_root))\nstart_wall=time.perf_counter();start_cpu=time.process_time()\nstorage=importlib.import_module(\"stellar_forge_buyer.storage\")\npackage=importlib.import_module(\"stellar_forge_buyer\")\nrecord={\"mode\":mode,\"storage_import_wall_seconds\":time.perf_counter()-start_wall,\"storage_import_cpu_seconds\":time.process_time()-start_cpu,\"storage_import_maxrss_kib\":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,\"storage_modules\":sorted(n for n in sys.modules if n==\"stellar_forge_buyer\"or n.startswith(\"stellar_forge_buyer.\"))}\nbefore=set(sys.modules);visible=dir(package)\nif set(sys.modules)!=before:raise ValueError(\"Directory inspection loaded an original engine\")\nif package.__all__!=expect[\"names\"]or not set(expect[\"names\"]).issubset(visible):raise ValueError(\"Public names/order changed\")\nif mode==\"candidate\"and any(n in record[\"storage_modules\"]for n in(\"stellar_forge_buyer.client\",\"stellar_forge_buyer.duckdb_dataset\",\"stellar_forge_buyer.postgres_delivery\",\"stellar_forge_buyer.research_workspace\")):raise ValueError(\"Unrelated public engines still loaded by local storage\")\nidentities={}\nfor name in expect[\"names\"]:\n value=getattr(package,name)\n original=getattr(importlib.import_module(expect[\"mapping\"][name],\"stellar_forge_buyer\"),name)\n if value is not original:raise ValueError(\"Original public object identity changed: \"+name)\n if pickle.loads(pickle.dumps(value))is not value:raise ValueError(\"Original class/function pickle identity changed: \"+name)\n identities[name]={\"module\":value.__module__,\"qualname\":value.__qualname__}\nnamespace={};exec(\"from stellar_forge_buyer import *\",namespace)\nif any(namespace[n]is not getattr(package,n)for n in expect[\"names\"]):raise ValueError(\"Star-import binding changed\")\ncached={n:getattr(package,n)for n in expect[\"names\"]}\nimportlib.reload(package)\nif any(getattr(package,n)is not cached[n]for n in expect[\"names\"]):raise ValueError(\"Reload changed original product identity\")\nstate=pathlib.Path(tempfile.mkdtemp(prefix=mode+\"-\",dir=sys.argv[4]))\nvalue={\"schema\":\"stellar-forge.original-storage-native.v1\",\"operation\":expect[\"operation\"],\"commit\":expect[\"commit\"],\"public_names\":len(expect[\"names\"])}\nstorage.dump(state/\"saved.json\",value,exclusive=True)\nif storage.parse(storage.read(state/\"saved.json\", 1024 * 1024))!=value:raise ValueError(\"Original saved source did not reopen\")\nrecord.update({\"public_objects\":identities,\"public_count\":len(identities),\"original_saved_bytes\":(state/\"saved.json\").stat().st_size,\"original_saved_sha256\":storage.digest((state/\"saved.json\").read_bytes()),\"state\":\"COMPLETE\"})\nprint(json.dumps(record,separators=(\",\",\":\")))"

def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()

def save(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError(f"Existing operation bytes differ: {path}")
        return
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())

def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Read-only original repository source")
    parser.add_argument("--out", type=Path, required=True, help="Persistent private operation directory")
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("source.json"))
    args = parser.parse_args()
    manifest_raw = args.manifest.read_bytes()
    manifest = json.loads(manifest_raw)
    if manifest["schema"] != "stellar-forge.python-buyer-import-native.v1":
        raise ValueError("Original source manifest required")
    source = args.source.resolve()
    root = args.out.absolute()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    result_path = root / "native-result.json"
    binding = {
        "operation": manifest["operation"], "commit": manifest["commit"],
        "manifest_sha256": hashlib.sha256(manifest_raw).hexdigest()
    }
    if result_path.is_file():
        previous = json.loads(result_path.read_text())
        if all(previous.get(key) == value for key, value in binding.items()) and previous.get("state") == "COMPLETE":
            print(json.dumps({"state": "REUSED_COMPLETE", "report": str(result_path), "result": previous}))
            return
        raise ValueError("Retained result belongs to an incomplete or different operation")
    save(root / "source.json", manifest_raw)
    baseline_init = manifest["baselineInit"]["content"].encode()
    if git_blob(baseline_init) != manifest["baselineInit"]["sha"]:
        raise ValueError("Original predecessor entry-module identity differs")
    original_names = next(
        ast.literal_eval(node.value) for node in ast.parse(baseline_init).body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "__all__" for target in node.targets)
    )
    if original_names != manifest["names"]:
        raise ValueError("Original public export order differs")
    inventory = []
    for entry in manifest["files"]:
        name = PurePosixPath(entry["path"])
        if name.is_absolute() or ".." in name.parts:
            raise ValueError("Source path must remain relative")
        relative = name.relative_to(PurePosixPath(manifest["packagePath"]))
        raw = (source / str(name)).read_bytes()
        if len(raw) != entry["bytes"] or git_blob(raw) != entry["sha"]:
            raise ValueError(f"Original source member differs: {name}")
        save(root / "candidate" / "stellar_forge_buyer" / str(relative), raw)
        old_raw = baseline_init if str(relative) == "__init__.py" else raw
        save(root / "baseline" / "stellar_forge_buyer" / str(relative), old_raw)
        inventory.append(entry)
    expected = root / "expectations.json"
    save(expected, json.dumps({
        "names": manifest["names"], "mapping": manifest["mapping"],
        "operation": manifest["operation"], "commit": manifest["commit"]
    }).encode())
    record = {
        "schema": "stellar-forge.python-buyer-import-result.v1", **binding,
        "baseline": manifest["parent"], "started": datetime.now(timezone.utc).isoformat(),
        "runtime": {"python": sys.executable, "version": sys.version.split()[0], "pid": os.getpid()},
        "source_files": inventory, "phases": []
    }
    try:
        for mode in ("baseline", "candidate"):
            process = subprocess.run(
                [sys.executable, "-B", "-c", PHASE, str(root / mode), mode, str(expected), str(root)],
                cwd=root, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                capture_output=True, timeout=120
            )
            save(root / f"{mode}-stdout.json", process.stdout)
            save(root / f"{mode}-stderr.txt", process.stderr)
            if process.returncode:
                raise RuntimeError(f"{mode} original import failed: " + process.stderr[-12000:].decode("utf-8", "replace"))
            phase = json.loads(process.stdout)
            record["phases"].append(phase)
            print(json.dumps({
                "state": "ORIGINAL_API_PHASE_COMPLETE", "mode": mode,
                "public_count": phase["public_count"],
                "storage_modules": phase["storage_modules"],
                "storage_import_wall_seconds": phase["storage_import_wall_seconds"],
                "storage_import_cpu_seconds": phase["storage_import_cpu_seconds"],
                "storage_import_maxrss_kib": phase["storage_import_maxrss_kib"]
            }), flush=True)
        if record["phases"][0]["public_objects"] != record["phases"][1]["public_objects"]:
            raise ValueError("Original public object module/qualname identities changed")
        record["state"] = "COMPLETE"
        record["completed"] = datetime.now(timezone.utc).isoformat()
    except BaseException as error:
        record["state"] = "FAILED"
        record["error"] = {"type": type(error).__name__, "message": str(error)}
        save(result_path, (json.dumps(record, indent=2) + "\n").encode())
        raise
    save(result_path, (json.dumps(record, indent=2) + "\n").encode())
    print(json.dumps({"state": "PYTHON_BUYER_IMPORT_COMPLETE", "report": str(result_path), **binding}), flush=True)

if __name__ == "__main__":
    run()

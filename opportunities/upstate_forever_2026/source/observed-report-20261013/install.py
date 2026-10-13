"""Install the observed-report picker into the current maintained application."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--workspace", type=Path)
    args = parser.parse_args()
    root = args.application.resolve(strict=True)
    if not (root / "model" / "workspace.py").is_file():
        raise ValueError("Select the maintained application directory containing model/workspace.py")
    for name in ("observed_context.py", "scientific_figures.py"):
        path = root / "model" / name
        compile(path.read_text(encoding="utf-8"), str(path), "exec")
    path = root / "operator" / "web" / "app.mjs"
    original = path.read_text(encoding="utf-8")
    updated = original
    edits = json.loads((root / "source" / "observed-report-20261013" / "operator-edits.json").read_text())["edits"]
    for edit in edits:
        if edit["path"] != "operator/web/app.mjs":
            raise ValueError("Unexpected picker target")
        if updated.count(edit["new"]) == 1:
            continue
        if updated.count(edit["old"]) != 1:
            raise ValueError("Compose this picker with the current deliveryForm at its unique original anchor")
        updated = updated.replace(edit["old"], edit["new"], 1)
    node = shutil.which("node")
    if node:
        with tempfile.NamedTemporaryFile(suffix=".mjs", mode="w", encoding="utf-8") as check:
            check.write(updated)
            check.flush()
            subprocess.run([node, "--check", check.name], check=True)
    if updated != original:
        previous = root / "source" / "observed-report-20261013" / ("app-before-" + hashlib.sha256(original.encode()).hexdigest() + ".mjs")
        if not previous.exists():
            previous.write_text(original, encoding="utf-8")
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".observed-picker-", mode="w", encoding="utf-8", delete=False) as pending:
            pending.write(updated)
            temporary = Path(pending.name)
        os.replace(temporary, path)
    result = {"picker": str(path), "changed": updated != original,
              "report_manifest": str(root / "observations/eighteenmile_2023/report_context" / "model-sources.json")}
    if args.workspace:
        sys.path.insert(0, str(root))
        from model.workspace import Workspace
        workspace = Workspace(args.workspace.resolve())
        manifest = json.loads(Path(result["report_manifest"]).read_text())
        entry = manifest["entries"][0]
        matching = [collection for collection in workspace.sources()
                    if any(row["id"] == entry["id"] and row["body"]["sha256"] == entry["sha256"]
                           for row in collection["entries"])]
        collection = matching[0] if matching else workspace.import_sources(result["report_manifest"])
        result["source_role"] = {"source_collection_id": collection["id"], "source_id": entry["id"]}
        result["workspace"] = str(args.workspace.resolve())
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

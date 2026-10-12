#!/usr/bin/env python3
"""Continue the completed GIS customer through its original local operator."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation-dir", required=True)
    parser.add_argument("--chromium", required=True, help="Existing compatible Chromium executable")
    parser.add_argument("--node", help="Existing Node executable")
    parser.add_argument("--playwright", help="Existing Playwright index.js")
    args = parser.parse_args()
    operation = Path(args.operation_dir).resolve(strict=True)
    native_path = operation / "native-gis-result.json"
    native_raw = native_path.read_bytes()
    native = json.loads(native_raw)
    if native.get("state") != "COMPLETE":
        raise RuntimeError("Finish the original native GIS operation before its browser continuation")
    continuation = json.loads((operation / "browser-continuation.json").read_text())
    source = hashlib.sha256(native_raw).hexdigest()
    package = Path(continuation["package"]).resolve(strict=True)
    sys.path.insert(0, str(package))
    from stellar_forge_buyer.duckdb_dataset import DuckDBWorkspace
    from stellar_forge_buyer.duckdb_http import serve
    from stellar_forge_buyer.storage import dump, private_directory

    output = private_directory(operation / "browser")
    result_path = output / "browser-result.json"
    if result_path.exists():
        previous = json.loads(result_path.read_text())
        if previous.get("native_result_sha256") != source:
            raise RuntimeError("Continue the original selected GIS result")
        if previous.get("receiving_complete") is True:
            print(json.dumps({"state": "REUSED", "result": str(result_path)}))
            return 0

    steps = {step["name"]: step["value"] for step in native["stages"]}
    node = args.node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    if not node:
        raise RuntimeError("Select the existing Node runtime")
    module_root = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES")
    playwright = args.playwright or (str(Path(module_root) / "playwright" / "index.js") if module_root else None)
    if not playwright or not Path(playwright).is_file():
        raise RuntimeError("Select the existing Playwright index.js with --playwright")
    chromium = str(Path(args.chromium).resolve(strict=True))
    if not os.access(chromium, os.X_OK):
        raise RuntimeError("The selected Chromium file is not executable")
    workspace = DuckDBWorkspace(continuation["workspace"], memory_limit="64MB", threads=1)
    server = thread = None
    token = ""
    try:
        server, control, launch = serve(workspace, spatial_extension=continuation["spatial_extension"],
            export_root=operation / "http-exports", handoff_root=operation / "http-handoffs")
        thread = threading.Thread(target=server.serve_forever, daemon=False)
        thread.start()
        parts = urlsplit(launch)
        token = parts.fragment
        origin = parts.scheme + "://" + parts.netloc

        def retained_state():
            req = Request(origin + "/api/state", headers={"X-DuckDB-Capability": token})
            with urlopen(req, timeout=90) as response:
                value = json.load(response)
            return {key: value[key] for key in ("editions", "views", "queries", "reviews", "exports", "handoffs", "spatial")}

        before_path = output / "customer-state-before.json"
        current = retained_state()
        if before_path.exists():
            before = json.loads(before_path.read_text())
            if before != current:
                raise RuntimeError("The original customer changed before this browser continuation")
        else:
            before = current
            dump(before_path, before, exclusive=True)
        source_files = {}
        for module in sorted((package / "stellar_forge_buyer").glob("*.py")):
            raw = module.read_bytes()
            source_files[str(module.relative_to(package))] = hashlib.sha1(
                b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        browser_input = {
            "source_files": source_files,
            "operation": native["operation"], "native_result_sha256": source,
            "output": str(output), "workspace": continuation["workspace"],
            "url": launch, "chromium": chromium, "playwright": str(Path(playwright).resolve()),
            "review": steps["review-geometry"], "layer": steps["adopt-layer"],
            "map": steps["original-native-map"], "query": steps["save-geographic-query"],
            "export": steps["original-crs-gis-export"],
        }
        env = dict(os.environ)
        env["TMPDIR"] = str(private_directory(output / "tmp"))
        proc = subprocess.run([node, str(Path(__file__).with_suffix(".mjs"))],
            input=json.dumps(browser_input), capture_output=True, text=True, env=env, timeout=240)
        for name, content in (("browser.stdout.json", proc.stdout), ("browser.stderr.txt", proc.stderr)):
            raw = content.replace(token, "[private capability]").encode()
            path = output / name
            path.write_bytes(raw)
            path.chmod(0o600)
        if not result_path.exists():
            raise RuntimeError("Browser returned without its retained result; inspect the same operation's stderr")
        result = json.loads(result_path.read_text())
        if proc.returncode or result.get("complete") is not True:
            raise RuntimeError("Continue the original browser result: " + str(result_path))
        if retained_state() != before:
            raise RuntimeError("The original retained customer changed during the browser continuation")
        if hashlib.sha256(native_path.read_bytes()).hexdigest() != source:
            raise RuntimeError("The selected original native result changed")
        result["retained_customer_state_unchanged"] = True
        server.shutdown()
        thread.join()
        server.server_close()
        server = None
        workspace.close()
        result.update(host_closed=True, receiver_closed=True, receiving_complete=True,
                      closed_at=datetime.now(timezone.utc).isoformat())
        dump(result_path, result)
        print(json.dumps({"state": "COMPLETE", "result": str(result_path),
                          "stages": len(result["stages"]), "downloads": len(result["downloads"])}))
        return 0
    finally:
        if server is not None:
            server.shutdown()
            if thread is not None:
                thread.join()
            server.server_close()
        workspace.close()


if __name__ == "__main__":
    raise SystemExit(main())

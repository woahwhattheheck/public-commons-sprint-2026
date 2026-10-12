#!/usr/bin/env python3
"""Run a complete vector operation with the selected native Python/GDAL runtime."""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

# A private package name avoids collisions with another application's common.py
# or an installed library called vector when embedded by a QGIS receiver.
PACKAGE = "_starforge_native_vector"
spec = importlib.util.spec_from_file_location(PACKAGE, Path(__file__).with_name("__init__.py"),
    submodule_search_locations=[str(Path(__file__).resolve().parent)])
api = importlib.util.module_from_spec(spec)
sys.modules[PACKAGE] = api
spec.loader.exec_module(api)
from _starforge_native_vector.common import parse_json, json_bytes, atomic_json, need, read_json

def dispatch(request):
    need(isinstance(request, dict), "VECTOR_REQUEST_REQUIRED")
    command = request.get("command")
    for name in ("selection", "profile"):
        file_key = name + "File"
        if file_key in request:
            need(name not in request, "VECTOR_DOCUMENT_SELECTOR_CONFLICT", name)
            request = {**request, name: read_json(request[file_key])}
    if command == "capabilities":
        return api.capabilities()
    if command == "capture":
        return api.capture_selection(request["selection"], request["sourceRoot"], request["directory"])
    if command == "inspect":
        return api.open_capture(request["directory"], request.get("expectedManifestSha256"))
    if command == "export":
        return api.export_capture(request["captureDirectory"], request["directory"],
                                  request.get("profile"), request["operationId"])
    if command == "open":
        return api.open_vector_export(request["directory"], request.get("expectedManifestSha256"),
                                      native=request.get("native", True))
    if command == "receive":
        return api.receive_vector_export(request["sourceDirectory"], request["directory"],
                                         request.get("expectedManifestSha256"))
    if command == "compare":
        return api.compare_captures(request["beforeDirectory"], request["afterDirectory"],
            request["directory"], request["operationId"],
            request.get("beforeManifestSha256"), request.get("afterManifestSha256"))
    if command == "open-comparison":
        return api.open_comparison(request["directory"], request.get("expectedManifestSha256"))
    if command == "changes":
        return api.comparison_page(request["directory"], request.get("offset", 0), request.get("limit", 100),
                                   request.get("layerId"), request.get("status"),
                                   request.get("expectedManifestSha256"))
    if command == "bundle":
        return api.create_bundle(request["directory"], request["archivePath"], request.get("expectedManifestSha256"))
    if command == "receive-bundle":
        return api.receive_bundle(request["archivePath"], request["directory"],
                                  request.get("expectedArchiveSha256"), request.get("expectedManifestSha256"))
    if command == "receive-comparison":
        return api.receive_comparison(request["sourceDirectory"], request["directory"],
                                       request.get("expectedManifestSha256"))
    raise api.VectorError("VECTOR_COMMAND_UNKNOWN", command)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", help="Exact JSON request file; omitted reads JSON from stdin")
    parser.add_argument("--result", help="Retain the complete original result JSON at this local path")
    args = parser.parse_args()
    os.environ["PROJ_NETWORK"] = "OFF"
    request = parse_json(Path(args.request).read_bytes() if args.request else sys.stdin.buffer.read())
    try:
        value = {"ok": True, "result": dispatch(request)}
        status = 0
    except Exception as exc:
        value = {"ok": False, "error": {"code": getattr(exc, "code", type(exc).__name__),
                                        "detail": getattr(exc, "detail", str(exc))}}
        status = 2
    if args.result:
        atomic_json(args.result, value)
    sys.stdout.buffer.write(json_bytes(value))
    sys.stdout.buffer.flush()
    return status

if __name__ == "__main__":
    raise SystemExit(main())

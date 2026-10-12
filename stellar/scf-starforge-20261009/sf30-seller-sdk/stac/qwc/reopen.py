# SPDX-License-Identifier: MIT
"""Reopen the whole received QWC map through the original native QGIS verifier."""
from __future__ import annotations

import argparse
import gc
import json
import os
from pathlib import Path
import signal
import sys

from contract import need, QwcError, read_json, digest, measure, keep_json, now, original_gis, identifier
from project import inspect_projection


def inspect_native(raw, checkpoint):
    model = original_gis()
    from starforge_stac.qgis_project import native_version
    root = Path(raw["receivingDirectory"])
    publication, body = read_json(root / "operation" / "publication.json")
    need(digest(body) == raw["publicationSha256"], "RECEIVED_PUBLICATION_CHANGED",
         "The selected native receiving belongs to a different publication.")
    workspace = model.QgisWorkspace(raw["gisDirectory"])
    snapshot, _ = read_json(root / "operation" / "source" / "workspace-snapshot.json")
    need(workspace.snapshot() == snapshot, "NATIVE_GIS_SNAPSHOT_CHANGED",
         "The complete original received GIS source and history changed.")
    selected = next((x for x in snapshot["state"]["projects"] if x["id"] == publication["qgis"]["projectId"]), None)
    need(selected is not None, "ORIGINAL_GIS_PROJECT_MISSING", "The original received project version is missing.")
    project_root = Path(raw["projectDirectory"])
    native_input, _ = read_json(project_root / "native-projection-input.json")
    retained, _ = read_json(project_root / "native-project.json")
    need(native_input.get("publicationId") == publication["publicationId"] and
         native_input.get("originalProject") == selected,
         "NATIVE_PROJECTION_INPUT_CHANGED", "The projected map no longer belongs to its original saved GIS selection.")
    project, actual = inspect_projection(workspace, project_root / "project.qgz", selected, native_input, checkpoint)
    try:
        need(actual["layers"] == retained["layers"] and actual["layouts"] == retained["layouts"],
             "NATIVE_RECEIVING_CHANGED", "The received native layer/layout interpretation differs from its original publication.")
        measured = measure(project_root / "project.qgz", publication["qgis"]["projectFile"])
        checkpoint()
        return {"schema": "starforge.stac-qwc-native-reopened.v1",
                "invocationId": identifier(raw.get("invocationId"), "invocationId"),
                "operationId": publication["operationId"], "requestId": publication["requestId"],
                "publicationId": publication["publicationId"], "publicationSha256": raw["publicationSha256"],
                "workspaceId": snapshot["state"]["id"], "revision": snapshot["state"]["revision"],
                "projectId": selected["id"], "projectFile": measured, "native": native_version(),
                "layers": actual["layers"], "layouts": actual["layouts"],
                "projectCrs": actual.get("projectCrs"), "relativePaths": True,
                "sourceIds": selected["sourceIds"]}
    finally:
        project.clear()
        del project
        gc.collect()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    raw, _ = read_json(args.input)
    need(raw.get("schema") == "starforge.stac-qwc-native-reopen-input.v1",
         "NATIVE_REOPEN_INPUT_REQUIRED", "Use the complete retained receiving input.")
    state = {"signal": None}
    def stop(signum, _frame):
        if state["signal"] is None:
            state["signal"] = signum
    def checkpoint():
        if state["signal"] is not None:
            raise QwcError("CANCELLED", "The original native receiving was cancelled.", signal=state["signal"])
    previous = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    app = None
    try:
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        from qgis.core import QgsApplication
        app = QgsApplication([], False)
        app.initQgis()
        try:
            result = inspect_native(raw, checkpoint)
        finally:
            app.exitQgis()
            app = None
        checkpoint()
        target = Path(raw["result"])
        if target.exists():
            previous_result, _ = read_json(target)
            need(all(previous_result.get(k) == v for k, v in result.items()),
                 "NATIVE_REOPEN_RESULT_CHANGED", "This receiving identity already retains another native result.")
            result = previous_result
        else:
            result["reopenedAt"] = now()
            keep_json(target, result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"error": getattr(error, "code", type(error).__name__), "message": str(error),
                          "details": getattr(error, "details", {})}, ensure_ascii=False), file=sys.stderr, flush=True)
        return 128 + state["signal"] if state["signal"] is not None else 2
    finally:
        try:
            if app is not None:
                app.exitQgis()
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)


if __name__ == "__main__":
    raise SystemExit(main())

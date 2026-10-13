#!/usr/bin/env python3
"""Open, preview and retain sourced Economic ranges in an existing Workspace."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model.workspace import Workspace
from model.common import atomic_json, digest, held, read_json
from economic_cost_ranges import EconomicCostRanges, ACTION

class LocalOperator:
    def __init__(self, root):
        self.workspace = Workspace(root)
        self.key = self.workspace.project["id"]
    def ws(self, key):
        if key != self.key:
            raise ValueError("The request belongs to another original Workspace.")
        return self.workspace
    def _ticket(self, workspace, path, descriptor, label):
        if workspace != self.key:
            raise ValueError("The output belongs to another Workspace.")
        return {**descriptor, "absolute_path": str(Path(path).resolve()), "label": label}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--action", choices=("catalog", "source", "preview", "build", "detail"), required=True)
    parser.add_argument("--id")
    parser.add_argument("--definition")
    parser.add_argument("--request", help="Retained original build request; required for build.")
    parser.add_argument("--operation", help="Original operation ID for a new retained request.")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    operator = LocalOperator(args.workspace)
    service = EconomicCostRanges(operator, ValueError)
    output = Path(args.output).resolve()
    if output.is_relative_to(operator.workspace.root) or operator.workspace.root.is_relative_to(output):
        raise ValueError("Keep CLI observations outside the immutable scientific Workspace.")
    if args.action in ("catalog", "source", "detail"):
        result = service.read(operator.key, args.action, {"id": args.id})
    elif args.action == "preview":
        if not args.definition:
            raise ValueError("Preview the actual authored definition file.")
        result = service.read(operator.key, "preview", {"definition": read_json(Path(args.definition))})
    else:
        if not args.request:
            raise ValueError("Retain the original build request before writing a saved result.")
        request_path = Path(args.request).resolve()
        if request_path.is_relative_to(operator.workspace.root):
            raise ValueError("Keep the command's original request outside the scientific Workspace.")
        if request_path == output:
            raise ValueError("Keep the original request and completed result in separate files.")
        with held(request_path.with_name(request_path.name + ".lock"), blocking=False):
            if request_path.exists():
                request = read_json(request_path)
                if (request.get("schema") != "upstate.economic-cost-ranges-cli-request/v1"
                        or request.get("workspace_id") != operator.key
                        or request.get("workspace_path") != str(operator.workspace.root)
                        or request.get("action") != ACTION
                        or digest(request["payload"]) != request.get("payload_sha256")):
                    raise ValueError("The retained original request belongs to another source or Workspace.")
                if args.operation and args.operation != request["operation_id"]:
                    raise ValueError("Continue the original operation ID.")
                if args.definition and read_json(Path(args.definition)) != request["payload"]["definition"]:
                    raise ValueError("The supplied definition differs from the retained original request.")
            else:
                if not args.operation or not args.definition:
                    raise ValueError("A new build needs an explicit original operation and definition.")
                import re
                if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", args.operation):
                    raise ValueError("Use an original operation ID of 16–100 letters, digits, underscores or hyphens.")
                definition = read_json(Path(args.definition))
                preview = service.read(operator.key, "preview", {"definition": definition})
                payload = {"definition": definition, "expected_preview_sha256": preview["preview_sha256"]}
                request = {"schema": "upstate.economic-cost-ranges-cli-request/v1",
                           "workspace_id": operator.key, "workspace_path": str(operator.workspace.root),
                           "action": ACTION, "operation_id": args.operation,
                           "payload": payload, "payload_sha256": digest(payload)}
                atomic_json(request_path, request, immutable=True)
            result = service.invoke({"workspace": operator.key, "action": ACTION,
                                     "operation_id": request["operation_id"], "payload": request["payload"]})
    atomic_json(output, result, immutable=True)
    print(json.dumps({"output": str(output), "id": result.get("id"),
                      "preview_sha256": result.get("preview_sha256")}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

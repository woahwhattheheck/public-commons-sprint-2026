#!/usr/bin/env python3
"""Receive one already-saved citation review through Python, then deliver and cold reopen it."""
from __future__ import annotations

import argparse
from contextlib import closing
import json
from pathlib import Path
import sys

from stellar_forge_buyer.errors import StateError
from stellar_forge_buyer.research_workspace import ResearchWorkspace
from stellar_forge_buyer.research_citations import (
    CitationDelivery, CitationReviewDraft, _need, _exists, _immutable, _pin,
    _object_file, _json, _INPUT_LIMIT, _STATE_LIMIT,
)
from stellar_forge_buyer.storage import digest, lock, parse, private_directory, read, write

SCHEMA = "stellar-forge.python-citation-analyst-receiving.v1"


def immutable_bytes(path, raw):
    if _exists(path):
        _need(read(path, len(raw)) == raw, "PYTHON_CITATION_INPUT_CHANGED")
    else:
        write(path, raw, exclusive=True)


def outputs_unchanged(files):
    for item in files:
        actual = _pin(item["file"], 512 * 1024 * 1024)
        _need(all(actual[key] == item[key] for key in ("bytes", "sha256")),
              "PYTHON_CITATION_OUTPUT_CHANGED")


def run(args):
    root = private_directory(Path(args.directory).expanduser().absolute())
    checkout = Path(args.checkout).expanduser().resolve()
    raw = read(Path(args.request_file).expanduser().absolute(), _INPUT_LIMIT)
    request = parse(raw)
    _need(isinstance(request, dict), "PYTHON_CITATION_REQUEST_REQUIRED")
    _need(args.operation_id and len(args.operation_id) <= 100, "PYTHON_CITATION_OPERATION_REQUIRED")
    source = {}
    python_root = Path(__file__).resolve().parent.parent
    for name in (
        "examples/research_citation_analyst.py", "research-bridge.mjs", "research-citation-delivery.mjs",
        "stellar_forge_buyer/research_citations.py", "stellar_forge_buyer/research_citation_analysis.py",
        "stellar_forge_buyer/research_workspace.py", "stellar_forge_buyer/analysis_workspace.py",
        "stellar_forge_buyer/analysis_workbooks.py", "stellar_forge_buyer/workspace_archive_receive.py",
    ):
        item = _pin(python_root / name, 4 * 1024 * 1024)
        source[name] = {key: item[key] for key in ("bytes", "sha256")}
    binding = {"schema": SCHEMA, "operationId": args.operation_id,
        "dossierId": args.dossier, "workspaceId": args.workspace_id,
        "requestId": request.get("requestId"), "requestBytes": len(raw), "requestSha256": digest(raw),
        "currentRevision": args.current_revision, "withWorkbook": bool(args.with_workbook), "source": source}
    with lock(root):
        _immutable(root / "operation.json", binding)
        immutable_bytes(root / "review-request.original.json", raw)
        completed = root / "complete.json"
        if _exists(completed):
            saved = _object_file(completed)
            _need(saved.get("binding") == binding, "PYTHON_CITATION_OPERATION_CHANGED")
            outputs_unchanged(saved["files"])
            CitationDelivery(root / "delivery").verify_receiving()
            CitationDelivery(root / "customer").verify_receiving()
            return saved
        with ResearchWorkspace(checkout=checkout, node=args.node, connection_file=args.connection,
                directory=root / "client", expected_workspace_id=args.workspace_id,
                timeout=args.wait_seconds, request_timeout_ms=min(args.wait_seconds * 1000, 900000)) as workspace:
            citations = workspace.citations(args.dossier)
            workspace.status()
            _need(workspace.workspace_id == args.workspace_id, "PYTHON_CITATION_WORKSPACE_CHANGED")
            checked = citations.validate(request)
            normalized = checked["request"]
            metadata = workspace.metadata(args.dossier)
            current = args.current_revision if args.current_revision is not None else metadata["revision"]
            selected = root / "review-selection.json"
            if _exists(selected):
                choice = _object_file(selected)
                _need(choice["requestSha256"] == checked["sha256"] and
                      (args.current_revision is None or choice["currentRevision"] == args.current_revision),
                      "PYTHON_CITATION_SELECTION_CHANGED")
                current = choice["currentRevision"]
            else:
                page = citations.detail(normalized["noticeId"], revision=current)
                review = next((row for row in page["detail"]["reviews"]
                               if row["requestId"] == normalized["requestId"]), None)
                _need(review is not None and review["request"] == normalized and
                      review["requestSha256"] == checked["sha256"], "PYTHON_CITATION_SAVED_REVIEW_REQUIRED")
                choice = {"schema": SCHEMA, "workspaceId": workspace.workspace_id, "dossierId": args.dossier,
                    "currentRevision": current, "requestSha256": checked["sha256"], "review": review}
                _immutable(selected, choice)
            actual = citations.detail(normalized["noticeId"], revision=current)
            saved_review = next((row for row in actual["detail"]["reviews"]
                                if row["id"] == choice["review"]["id"]), None)
            _need(saved_review == choice["review"], "PYTHON_CITATION_REVIEW_CHANGED")
            # The full original JSON is received into an explicit draft revision.
            # This customer receiver only replays an already-proven saved request.
            draft = citations.draft(root / "draft", notice_id=normalized["noticeId"],
                request_id=normalized["requestId"], actor=normalized["actor"], revision=normalized["expectedRevision"])
            if not _exists(draft.directory / "pending.json"):
                revision = draft.current()
                if revision["request"] != request:
                    _need(revision["editRevision"] == 1, "PYTHON_CITATION_DRAFT_CHANGED")
                    draft.import_file(root / "review-request.original.json", expected_edit_revision=1)
            revision = draft.current()
            _need(citations.validate(revision["request"]) == checked, "PYTHON_CITATION_DRAFT_CHANGED")
            head = workspace.metadata(args.dossier)["revision"]
            reply = draft.submit(citations, expected_edit_revision=revision["editRevision"], recover=True)
            _need(reply["review"] == saved_review and reply.get("duplicate") is True and
                  workspace.metadata(args.dossier)["revision"] == head,
                  "PYTHON_CITATION_EXACT_RECOVERY_CHANGED")
            _immutable(root / "saved-reply.json", reply)
            delivery = citations.delivery(normalized["requestId"], root / "delivery", current_revision=current)
            exported = delivery.export(citations)
            _need(workspace.metadata(args.dossier)["revision"] == head, "PYTHON_CITATION_HEAD_CHANGED")
        received = delivery.receive(root / "received", checkout=checkout, node=args.node, timeout=args.wait_seconds)
        extras = {"inputs/review-request.original.json": root / "review-request.original.json"}
        analysis = None
        if args.with_workbook:
            from stellar_forge_buyer.research_citation_analysis import run_citation_analysis
            analysis = run_citation_analysis(delivery, root / "analysis", checkout=checkout,
                                             node=args.node, wait_seconds=args.wait_seconds)
            for name, item in analysis["files"].items():
                extras["analysis/" + name] = Path(item["file"])
            # Public handover metadata names actual original Analysis IDs and
            # byte pins; connection credentials and live workspace paths are omitted.
            analysis_selection = {"schema": SCHEMA, "workspaceId": analysis["workspaceId"],
                "sourceRows": analysis["source"]["rows"], "sourceDocumentId": analysis["source"]["documentId"],
                "queryId": analysis["queryId"], "queryResultSha256": analysis["queryResultSha256"],
                "exportId": analysis["exportId"], "workbookId": analysis["workbookId"],
                "archiveId": analysis["archiveId"],
                "files": {name: {key: item[key] for key in ("bytes", "sha256")}
                          for name, item in analysis["files"].items()},
                "coldReceive": {"workspaceId": analysis["receiving"]["workspaceId"],
                                "sourceFiles": analysis["receiving"]["sourceFiles"]}}
            _immutable(root / "analysis-delivery.json", analysis_selection)
            extras["analysis/selection.json"] = root / "analysis-delivery.json"
        artifact = delivery.archive(root / "Citation_Analyst_Complete_Handover.zip", extras=extras)
        customer = CitationDelivery.from_archive(artifact["file"], root / "customer",
                                                  expected_sha256=artifact["sha256"])
        customer.receive(root / "customer-received", checkout=checkout, node=args.node, timeout=args.wait_seconds)
        _need(customer.selection == delivery.selection, "PYTHON_CITATION_CUSTOMER_SELECTION_CHANGED")
        _need(read(root / "customer" / "inputs" / "review-request.original.json", _INPUT_LIMIT) == raw,
              "PYTHON_CITATION_CUSTOMER_REQUEST_CHANGED")
        if analysis:
            _need(_object_file(root / "customer" / "analysis" / "selection.json") == analysis_selection,
                  "PYTHON_CITATION_CUSTOMER_ANALYSIS_CHANGED")
            outputs_unchanged([{"file": str(root / "customer" / "analysis" / name), **pin}
                               for name, pin in analysis_selection["files"].items()])
        files = [artifact, _pin(root / "review-request.original.json"), _pin(root / "saved-reply.json"),
                 _pin(root / "delivery" / "selection.json"), _pin(root / "delivery" / "delivery.json"),
                 _pin(root / "delivery" / "receiving.json")]
        files.extend(_pin(delivery.files / item["name"]) for item in exported["files"])
        if analysis:
            files.extend(_pin(item["file"]) for item in analysis["files"].values())
            files.append(_pin(root / "analysis-delivery.json"))
        result = {"schema": SCHEMA, "state": "COMPLETE", "binding": binding,
            "reviewId": saved_review["id"], "requestId": saved_review["requestId"],
            "originalRevision": saved_review["originalRevision"], "reviewedRevision": saved_review["revision"],
            "currentRevision": current, "workspaceId": args.workspace_id,
            "exactSavedRequestRecovered": True, "originalHeadUnchanged": True,
            "reports": len(exported["files"]), "receivers": sorted(received),
            "customerHandoverVerified": True, "workbook": analysis_selection if analysis else None,
            "files": files}
        _immutable(completed, result)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("directory", "checkout", "connection", "workspace-id", "dossier", "request-file", "operation-id"):
        parser.add_argument("--" + option, required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--current-revision", type=int)
    parser.add_argument("--wait-seconds", type=int, default=900)
    parser.add_argument("--with-workbook", action="store_true")
    args = parser.parse_args()
    _need(1 <= args.wait_seconds <= 900, "PYTHON_CITATION_WAIT_INVALID")
    try:
        result = run(args)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2))
    except (StateError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"state": "INCOMPLETE", "error": getattr(error, "code", type(error).__name__),
                          "directory": str(Path(args.directory).absolute())}, sort_keys=True))
        raise SystemExit(1)


if __name__ == "__main__":
    main()

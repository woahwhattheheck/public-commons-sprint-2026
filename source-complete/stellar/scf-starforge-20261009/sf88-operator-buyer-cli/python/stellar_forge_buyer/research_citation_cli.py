"""Installed citation analyst commands for the original Research Python CLI."""
from __future__ import annotations

from pathlib import Path

from .errors import StateError
from .research_citations import CitationReviewDraft, CitationDelivery, _object_file
from .research_workspace import ResearchWorkspace
from .storage import read, parse


def add_citation_commands(commands):
    selected = commands.add_parser("citation-list", help="List notices at one stable dossier revision.")
    selected.add_argument("--dossier", required=True)
    selected.add_argument("--revision", type=int)
    selected.add_argument("--offset", type=int, default=0)
    selected.add_argument("--limit", type=int, default=30)
    selected.add_argument("--status", choices=("all", "pending", "reviewed"), default="all")
    selected.add_argument("--all", action="store_true")
    selected = commands.add_parser("citation-detail", help="Read complete source, evidence, findings and review history.")
    selected.add_argument("--dossier", required=True)
    selected.add_argument("--notice", required=True)
    selected.add_argument("--revision", type=int)
    selected = commands.add_parser("citation-draft", help="Retain the full original review base and editable request.")
    selected.add_argument("--dossier", required=True)
    selected.add_argument("--notice", required=True)
    selected.add_argument("--revision", type=int)
    selected.add_argument("--draft", required=True)
    selected.add_argument("--request-id", required=True)
    selected.add_argument("--actor", required=True)
    for name in ("citation-draft-show", "citation-draft-export", "citation-draft-import", "citation-edit"):
        selected = commands.add_parser(name)
        selected.add_argument("--draft", required=True)
        if name in {"citation-draft-export", "citation-draft-import"}:
            selected.add_argument("--file", required=True)
        if name in {"citation-draft-import", "citation-edit"}:
            selected.add_argument("--expected-edit-revision", type=int, required=True)
        if name == "citation-edit":
            selected.add_argument("--actor")
            selected.add_argument("--decision", choices=("retain", "revise", "exclude", "follow-up"))
            selected.add_argument("--reason-file", help="UTF-8 complete review reason")
            for kind in ("evidence", "finding", "disposition"):
                selected.add_argument("--" + kind + "-file", help="One complete JSON record")
    selected = commands.add_parser("citation-save", help="Freeze and send the original atomic request.")
    selected.add_argument("--dossier", required=True)
    selected.add_argument("--draft", required=True)
    selected.add_argument("--expected-edit-revision", type=int, required=True)
    selected.add_argument("--recover", action="store_true", help="Use the same saved request after an interrupted reply.")
    selected = commands.add_parser("citation-recover", help="Recover an existing exact request from the original call journal.")
    selected.add_argument("--dossier", required=True)
    selected.add_argument("--request-id", required=True)
    selected = commands.add_parser("citation-deliver", help="Freeze revisions and retain all twelve full reports/portable files.")
    selected.add_argument("--dossier", required=True)
    selected.add_argument("--request-id", required=True)
    selected.add_argument("--out", required=True)
    selected.add_argument("--current-revision", type=int)
    selected.add_argument("--archive")
    selected = commands.add_parser("citation-unpack", help="Receive the exact complete analyst handover ZIP.")
    selected.add_argument("--file", required=True)
    selected.add_argument("--sha256", required=True)
    selected.add_argument("--target", required=True)
    for name in ("citation-verify", "citation-receive", "citation-archive", "citation-workbook"):
        selected = commands.add_parser(name)
        selected.add_argument("--delivery", required=True)
        if name in {"citation-receive", "citation-workbook"}:
            selected.add_argument("--target", required=True)
        if name == "citation-archive":
            selected.add_argument("--file", required=True)
        if name == "citation-workbook":
            selected.add_argument("--wait-seconds", type=int, default=900)


def run_citation_command(args):
    name = args.command
    if name == "citation-unpack":
        return CitationDelivery.from_archive(args.file, args.target, expected_sha256=args.sha256).verify()
    if name.startswith("citation-draft-") or name == "citation-edit":
        draft = CitationReviewDraft(args.draft)
        if name == "citation-draft-show":
            return {"selection": draft.selection, "draft": draft.current(),
                    "pending": _object_file(draft.directory / "pending.json") if (draft.directory / "pending.json").is_file() else None}
        if name == "citation-draft-export":
            return draft.export_request(args.file)
        if name == "citation-draft-import":
            return draft.import_file(args.file, expected_edit_revision=args.expected_edit_revision)
        return draft.edit(expected_edit_revision=args.expected_edit_revision, actor=args.actor,
            decision=args.decision,
            reason=read(Path(args.reason_file), 100000).decode("utf-8") if args.reason_file else None,
            evidence=_object_file(args.evidence_file) if args.evidence_file else None,
            finding=_object_file(args.finding_file) if args.finding_file else None,
            disposition=_object_file(args.disposition_file) if args.disposition_file else None)
    if name in {"citation-verify", "citation-receive", "citation-archive", "citation-workbook"}:
        delivery = CitationDelivery(args.delivery)
        if name == "citation-verify":
            return delivery.verify()
        if name == "citation-archive":
            return delivery.archive(args.file)
        if not args.checkout:
            raise ValueError("--checkout is required for the original receiver")
        if name == "citation-receive":
            return delivery.receive(args.target, checkout=args.checkout, node=args.node, timeout=args.timeout)
        from .research_citation_analysis import run_citation_analysis
        return run_citation_analysis(delivery, args.target, checkout=args.checkout, node=args.node,
                                     wait_seconds=args.wait_seconds)
    if not args.checkout or not args.connection:
        raise ValueError("--checkout and --connection are required")
    with ResearchWorkspace(checkout=args.checkout, node=args.node, connection_file=args.connection,
            directory=args.directory, timeout=args.timeout, request_timeout_ms=args.request_timeout_ms) as workspace:
        citations = workspace.citations(args.dossier)
        if name == "citation-list":
            if args.all:
                return {"items": list(citations.iter_notices(revision=args.revision, status=args.status,
                                                             limit=args.limit))}
            return citations.list(revision=args.revision, offset=args.offset, limit=args.limit, status=args.status)
        if name == "citation-detail":
            return citations.detail(args.notice, revision=args.revision)
        if name == "citation-draft":
            draft = citations.draft(args.draft, notice_id=args.notice, revision=args.revision,
                                    request_id=args.request_id, actor=args.actor)
            return {"selection": draft.selection, "draft": draft.current()}
        if name == "citation-save":
            draft = CitationReviewDraft(args.draft)
            return draft.submit(citations, expected_edit_revision=args.expected_edit_revision, recover=args.recover)
        if name == "citation-recover":
            return citations.recover(args.request_id)
        if name == "citation-deliver":
            delivery = citations.delivery(args.request_id, args.out, current_revision=args.current_revision)
            result = {"selection": delivery.selection, "delivery": delivery.export(citations)}
            if args.archive:
                result["receiving"] = delivery.receive(delivery.directory / "received",
                    checkout=args.checkout, node=args.node, timeout=args.timeout)
                result["archive"] = delivery.archive(args.archive)
            return result
    raise StateError("CITATION_COMMAND_INVALID")

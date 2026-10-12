"""Study-extraction commands on the original authenticated Research transport."""
from __future__ import annotations

from pathlib import Path

from .research_extraction import EXTRACTION_SECTIONS, PUBLICATION_SECTIONS
from .research_workspace import ResearchWorkspace
from .storage import parse, read

_LIMIT = 16 * 1024 * 1024


def _dossier(command):
    command.add_argument("--dossier", required=True)


def _page(command, sections):
    command.add_argument("--revision", type=int)
    command.add_argument("--section", choices=sections, default="overview")
    command.add_argument("--offset", type=int, default=0)
    command.add_argument("--limit", type=int, default=30)


def add_extraction_commands(commands):
    view = commands.add_parser("extraction-view",
        help="Read the original form/result/submission/review state at one revision.")
    _dossier(view)
    _page(view, EXTRACTION_SECTIONS)
    view.add_argument("--form-id")
    view.add_argument("--result-set-id")

    source = commands.add_parser("extraction-source-values",
        help="Resolve pointers against one original retained occurrence with the Decimal parser.")
    _dossier(source)
    source.add_argument("--revision", type=int, required=True)
    source.add_argument("--occurrence-id", required=True)
    source.add_argument("--file-name", help="Exact retained SourceBundle member name, when selected.")
    choices = source.add_mutually_exclusive_group(required=True)
    choices.add_argument("--pointer", action="append",
        help="One JSON pointer; repeat to read a source-bound batch. An empty string selects the record.")
    choices.add_argument("--pointers-file", help="A JSON array of exact JSON pointer strings.")

    publications = commands.add_parser("extraction-publications",
        help="Page the original table definitions, publications, rows and publication impacts.")
    _dossier(publications)
    _page(publications, PUBLICATION_SECTIONS)
    publications.add_argument("--table-id")
    publications.add_argument("--publication-id")
    publications.add_argument("--from-publication-id")
    publications.add_argument("--to-publication-id")
    publications.add_argument("--current-only", action="store_true")
    publications.add_argument("--change-type", choices=("all", "added", "removed", "changed", "unchanged"), default="all")

    for name, label in (
        ("extraction-review", "Apply one complete original extraction request."),
        ("extraction-publication-review", "Apply one complete original publication request."),
    ):
        child = commands.add_parser(name, help=label)
        _dossier(child)
        child.add_argument("--request", required=True,
            help="Exact original requestId/expectedRevision/actor/action/data JSON file.")
        child.add_argument("--resume", action="store_true",
            help="Resume this same retained request after an interrupted reply.")

    for name in ("extraction-saved-request", "extraction-recover"):
        child = commands.add_parser(name,
            help="Read or recover the selected existing extraction/publication request.")
        _dossier(child)
        child.add_argument("--request-id", required=True)

    report = commands.add_parser("extraction-export",
        help="Download the original complete extraction report at one revision.")
    _dossier(report)
    report.add_argument("--revision", type=int, required=True)
    report.add_argument("--form-id")
    report.add_argument("--result-set-id")
    report.add_argument("--format", choices=("json", "md", "html"), default="json")
    report.add_argument("--expected-sha256")
    report.add_argument("file")

    export = commands.add_parser("extraction-publication-export",
        help="Download the complete original publication or comparison with verified bytes.")
    _dossier(export)
    export.add_argument("--revision", type=int, required=True)
    export.add_argument("--table-id")
    export.add_argument("--publication-id")
    export.add_argument("--against-publication-id")
    export.add_argument("--format", choices=("json", "csv", "md", "html"), default="json")
    export.add_argument("--expected-sha256")
    export.add_argument("file")


def run_extraction_command(arguments):
    if not arguments.checkout or not arguments.connection:
        raise ValueError("--checkout and --connection are required")
    with ResearchWorkspace(checkout=arguments.checkout, node=arguments.node,
            connection_file=arguments.connection, directory=arguments.directory,
            timeout=arguments.timeout, request_timeout_ms=arguments.request_timeout_ms) as workspace:
        extraction = workspace.extraction(arguments.dossier)
        command = arguments.command
        if command == "extraction-view":
            return extraction.read(revision=arguments.revision, section=arguments.section,
                form_id=arguments.form_id, result_set_id=arguments.result_set_id,
                offset=arguments.offset, limit=arguments.limit)
        if command == "extraction-source-values":
            pointers = arguments.pointer
            if arguments.pointers_file:
                pointers = parse(read(Path(arguments.pointers_file), _LIMIT))
            return extraction.source_values(arguments.occurrence_id, pointers,
                revision=arguments.revision, file_name=arguments.file_name)
        if command == "extraction-publications":
            return extraction.publications(revision=arguments.revision,
                section=arguments.section, table_id=arguments.table_id,
                publication_id=arguments.publication_id,
                from_publication_id=arguments.from_publication_id,
                to_publication_id=arguments.to_publication_id,
                current_only=arguments.current_only, change_type=arguments.change_type,
                offset=arguments.offset, limit=arguments.limit)
        if command in ("extraction-review", "extraction-publication-review"):
            request = parse(read(Path(arguments.request), _LIMIT))
            method = extraction.review if command == "extraction-review" else extraction.review_publication
            return method(request, resume=arguments.resume)
        if command == "extraction-saved-request":
            return extraction.saved_request(arguments.request_id)
        if command == "extraction-recover":
            return extraction.recover(arguments.request_id)
        if command == "extraction-export":
            return extraction.export(arguments.file,
                revision=arguments.revision, form_id=arguments.form_id,
                result_set_id=arguments.result_set_id, format=arguments.format,
                expected_sha256=arguments.expected_sha256).native
        if command == "extraction-publication-export":
            return extraction.export_publication(arguments.file,
                revision=arguments.revision, table_id=arguments.table_id,
                publication_id=arguments.publication_id, format=arguments.format,
                against_publication_id=arguments.against_publication_id,
                expected_sha256=arguments.expected_sha256).native
        raise ValueError("Unknown extraction command")

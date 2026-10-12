"""Command-line access to the Python Research client and original source closure."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .errors import BuyerError
from .storage import parse, read
from .research_workspace import ResearchError, ResearchWorkspace, _file_delivery
from .research_documents import ResearchDocumentSource
from .research_citation_cli import add_citation_commands, run_citation_command
from .research_extraction_cli import add_extraction_commands, run_extraction_command
from .research_eligibility_cli import add_eligibility_commands, run_eligibility_command

_READ = {"status", "dossiers", "metadata", "section", "compare", "documents-list",
         "documents-review", "documents-elements", "pipelines-list", "pipelines-operation",
         "pipelines-provider-jobs", "pipelines-review", "pipelines-elements"}
_DOWNLOAD = {"export-dossier", "export-edition", "export-comparison", "documents-download",
             "pipelines-download-input", "pipelines-download-output", "pipelines-download"}
_SAFE = {"pipelines-prepare", "pipelines-submit", "pipelines-refresh", "pipelines-cancel",
         "pipelines-reconcile", "pipelines-retain", "pipelines-receive", "documents-receive",
         "reopen-dossier"}
_EDITS = {"create-dossier", "update-dossier", "add-question", "update-question", "add-finding",
          "update-finding", "select-evidence", "update-selection", "receive-research-file"}


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--checkout")
    value.add_argument("--node", default="node")
    value.add_argument("--connection")
    value.add_argument("--directory", required=True)
    value.add_argument("--timeout", type=int, default=360)
    value.add_argument("--request-timeout-ms", type=int, default=120000)
    commands = value.add_subparsers(dest="command", required=True)
    add_citation_commands(commands)
    add_extraction_commands(commands)
    add_eligibility_commands(commands)
    commands.add_parser("status")
    saved = commands.add_parser("calls")
    saved.add_argument("--offset", type=int, default=0)
    saved.add_argument("--limit", type=int, default=100)
    for name in ("call-record", "resume"):
        child = commands.add_parser(name)
        child.add_argument("request_id")
    call = commands.add_parser("call", help="Send an exact original SDK request from a local JSON file.")
    call.add_argument("action", choices=sorted(_READ | _DOWNLOAD | _SAFE | _EDITS))
    call.add_argument("--input", required=True)
    call.add_argument("--request-id")
    source = commands.add_parser("source", help="Verify a complete retained edition and prepare its Analysis source.")
    source.add_argument("--edition", required=True)
    source.add_argument("--edition-sha256", required=True)
    source.add_argument("--file-sha256")
    source.add_argument("--title", default="Retained document elements")
    source.add_argument("--captured-at")
    commands.add_parser("source-inspect")
    original = commands.add_parser("source-export")
    original.add_argument("role")
    original.add_argument("file")
    register = commands.add_parser("register-source")
    register.add_argument("--analysis", required=True)
    register.add_argument("--name", required=True)
    register.add_argument("--expected-revision", type=int, default=0)
    return value


def main(argv=None):
    arguments = parser().parse_args(argv)
    try:
        if arguments.command.startswith("eligibility-"):
            result = run_eligibility_command(arguments)
        elif arguments.command.startswith("extraction-"):
            result = run_extraction_command(arguments)
        elif arguments.command.startswith("citation-"):
            result = run_citation_command(arguments)
        elif arguments.command in {"source", "source-inspect", "source-export", "register-source"}:
            if arguments.command == "source":
                if not arguments.checkout:
                    raise ValueError("--checkout is required to use the original edition verifier")
                source = ResearchDocumentSource.create(arguments.edition, arguments.directory,
                    checkout=arguments.checkout, node=arguments.node, timeout=arguments.timeout,
                    expected_edition_sha256=arguments.edition_sha256,
                    expected_sha256=arguments.file_sha256, title=arguments.title,
                    captured_at=arguments.captured_at)
                result = {"manifestFile": str(source.manifest_file), **source.verify(),
                          "receipt": source.receipt}
            else:
                source = ResearchDocumentSource(arguments.directory)
                if arguments.command == "source-export":
                    result = source.original(arguments.role, arguments.file).native
                elif arguments.command == "register-source":
                    from .analysis_workspace import AnalysisWorkspace
                    workspace = AnalysisWorkspace(arguments.analysis, checkout=arguments.checkout,
                                                  node=arguments.node)
                    try:
                        result = source.register(workspace, arguments.name,
                                                 expected_revision=arguments.expected_revision)
                    finally:
                        workspace.close()
                else:
                    result = {"manifest": source.manifest, "receipt": source.receipt, **source.verify()}
        else:
            if not arguments.checkout or not arguments.connection:
                raise ValueError("--checkout and --connection are required")
            with ResearchWorkspace(checkout=arguments.checkout, node=arguments.node,
                    connection_file=arguments.connection, directory=arguments.directory,
                    timeout=arguments.timeout, request_timeout_ms=arguments.request_timeout_ms) as workspace:
                if arguments.command == "status":
                    result = workspace.status()
                elif arguments.command == "calls":
                    result = workspace.calls(offset=arguments.offset, limit=arguments.limit)
                elif arguments.command == "call-record":
                    result = workspace.call_record(arguments.request_id)
                elif arguments.command == "resume":
                    result = workspace.resume(arguments.request_id)
                else:
                    value = parse(read(Path(arguments.input), 1024 * 1024))
                    if not isinstance(value, dict):
                        raise ValueError("--input must contain one JSON object")
                    if arguments.action in _READ | _DOWNLOAD:
                        result = workspace._read(arguments.action, value)
                        if arguments.action in _DOWNLOAD:
                            with _file_delivery(result).open():
                                pass
                    else:
                        if not arguments.request_id:
                            raise ValueError("--request-id is required for a saved mutation")
                        result = workspace._write(arguments.action, value,
                            request_id=arguments.request_id, replay_safe=arguments.action in _SAFE)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
        return 0
    except ResearchError as error:
        print(json.dumps({"error": error.code, "requestId": error.request_id,
                          "record": error.record}, ensure_ascii=False), file=sys.stderr)
        return 2
    except (BuyerError, OSError, ValueError) as error:
        print(json.dumps({"error": getattr(error, "code", type(error).__name__),
                          "detail": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

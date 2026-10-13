"""CLI joins for the original Analysis dataset publication and source jobs."""
from __future__ import annotations

import json
from pathlib import Path
import time

from .analysis_publication import _fields, _need
from .analysis_publication_delivery import DatasetPublication, download_file, download_publication
from .storage import parse, read


def configure(commands):
    selected = commands.add_parser("dataset-read", help="Read completed typed exports, saved recipes, packages and original source decisions")
    selected.add_argument("--action", required=True, choices=[
        "configuration", "exports", "review", "recipes", "recipe", "jobs", "job",
        "package", "source-jobs", "source-read", "source-files"])
    selected.add_argument("--request", help="JSON file with the exact selected identities")
    recipe = commands.add_parser("dataset-recipe", help="Save one reviewed column/licensing recipe with its stable request ID")
    recipe.add_argument("--request", required=True)
    for kind in ("dataset-package", "dataset-source"):
        action = commands.add_parser(kind, help="Run or reopen the same original request; native workbench state remains in the result")
        action.add_argument("--request", required=True)
    cancel = commands.add_parser("dataset-cancel", help="Cancel the selected original local job; inspect its accepted native result afterward")
    cancel.add_argument("--id", required=True)
    download = commands.add_parser("dataset-download", help="Stream an exact retained file or complete portable edition")
    download.add_argument("--id", required=True)
    download.add_argument("--source", action="store_true", help="Download the retained original Frictionless source export")
    download.add_argument("--name", help="Exact native filename; omit for the complete edition")
    download.add_argument("--out", required=True, help="File path with --name, otherwise a private receiving directory")
    download.add_argument("--expected-sha256", help="Expected file hash with --name, otherwise the original index hash")
    offline = commands.add_parser("dataset-open", help="Verify and inspect a complete local package or source delivery without an Analysis host")
    offline.add_argument("--directory", required=True)
    offline.add_argument("--expected-index-sha256")


def _request(args):
    value = parse(read(Path(args.request).expanduser().absolute(), 1024 * 1024)) if args.request else {}
    _need(isinstance(value, dict), "REQUEST_INVALID")
    return value


def offline(args):
    if args.command != "dataset-open":
        return False
    print(json.dumps(DatasetPublication(args.directory, expected_index_sha256=args.expected_index_sha256).inspect(),
                     ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    return True


def execute(workspace, args):
    publication = workspace.publications
    if args.command == "dataset-read":
        request = _request(args)
        action = args.action
        if action == "configuration":
            _fields(request, set())
            result = publication.configuration()
        elif action in {"exports", "recipes", "jobs", "source-jobs"}:
            _fields(request, set(), {"before", "limit"})
            method = (publication.sources.history if action == "source-jobs" else
                      publication.history if action == "jobs" else getattr(publication, action))
            result = method(**request)
        elif action == "review":
            _fields(request, {"query_export_id"}, {"manifest_sha256", "sample_rows"})
            result = publication.review(request["query_export_id"],
                                        manifest_sha256=request.get("manifest_sha256"),
                                        sample_rows=request.get("sample_rows", 20))
        elif action == "recipe":
            _fields(request, {"id"}); result = publication.recipe(request["id"])
        elif action == "job":
            _fields(request, {"id"}); result = workspace.job(request["id"])
            _need(result["kind"] in {"dataset-package", "dataset-source"}, "JOB_NOT_FOUND")
        elif action == "package":
            _fields(request, {"id"}); result = publication.sources.package_view(request["id"])
        elif action == "source-files":
            _fields(request, {"id"}); result = publication.sources.downloads(request["id"])
        else:
            result = publication.sources.read(request)
    elif args.command == "dataset-recipe":
        result = publication.save_recipe(_request(args))
    elif args.command in {"dataset-package", "dataset-source"}:
        result = workspace.start(args.command, _request(args))
        while result["status"] == "RUNNING":
            time.sleep(0.1)
            result = workspace.job(result["id"])
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        if result["status"] != "COMPLETE":
            raise SystemExit(1)
        return True
    elif args.command == "dataset-cancel":
        result = publication.cancel(args.id)
    elif args.command == "dataset-download":
        if args.name:
            owner = publication.sources if args.source else publication
            result = download_file(owner, args.id, args.name, args.out,
                                   expected_sha256=args.expected_sha256)
        else:
            result = download_publication(workspace, args.id, args.out, source=args.source,
                                          expected_index_sha256=args.expected_sha256)
    else:
        return False
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    return True

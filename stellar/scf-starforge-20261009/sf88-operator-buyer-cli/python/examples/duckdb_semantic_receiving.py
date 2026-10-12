#!/usr/bin/env python3
"""Receive a finalized semantic dataset through the original DuckDB HTTP operator."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import threading
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
import zipfile

from stellar_forge_buyer import DuckDBWorkspace
from stellar_forge_buyer.duckdb_http import serve
from stellar_forge_buyer.storage import dump, parse, private_directory, read, write

SCHEMA = "stellar-forge.duckdb-semantic-receiving.v1"


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def opened(workspace, directory):
    server, _, launch = serve(workspace, export_root=directory / "exports",
                             handoff_root=directory / "handoffs")
    thread = threading.Thread(target=server.serve_forever, daemon=False)
    thread.start()
    parts = urlsplit(launch)
    base = parts.scheme + "://" + parts.netloc
    identity = workspace.identity()["workspace_id"]

    def request(path, body=None, *, raw=False, method=None):
        headers = {"X-DuckDB-Capability": parts.fragment,
                   "X-DuckDB-Workspace-ID": identity}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
            headers["Content-Type"] = "application/json"
        req = Request(base + path, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=120) as response:
                payload = response.read()
                return (payload, dict(response.headers)) if raw else parse(payload)
        except HTTPError as error:
            detail = error.read(8192).decode("utf-8", "replace")
            raise RuntimeError("Native HTTP " + str(error.code) + ": " + detail) from None

    try:
        yield request
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def receive_files(request, record, destination):
    target = private_directory(destination)
    received = []
    for file in record["files"]:
        name = file["name"]
        member = PurePosixPath(name)
        require(not member.is_absolute() and all(part not in {"", ".", ".."} for part in name.split("/")),
                "Native export supplied an invalid member")
        raw, headers = request("/api/exports/" + quote(record["export_id"], safe="") +
                               "/file?name=" + quote(name, safe=""), raw=True)
        require(len(raw) == file["bytes"] and sha(raw) == file["sha256"],
                "Native export file identity changed: " + name)
        path = target / name
        private_directory(path.parent)
        if path.exists():
            require(read(path, max(len(raw), 1)) == raw, "Receiving file changed: " + name)
        else:
            write(path, raw, exclusive=True)
        received.append({"name": name, "bytes": len(raw), "sha256": sha(raw),
                         "content_type": headers.get("Content-Type")})
    return received


def run(args):
    directory = private_directory(Path(args.directory))
    report = Path(args.report).expanduser().resolve(strict=True)
    source = {"report": str(report), "report_sha256": sha(read(report, 8 * 1024 * 1024)),
              "source_column": args.source_column, "sql_column": args.sql_column,
              "compare_column": args.compare_column, "view": args.view,
              "expected_rows": args.expected_rows, "expected_semantics": args.expected_semantics}
    record_path = directory / "receiving.json"
    if record_path.exists():
        record = parse(read(record_path, 8 * 1024 * 1024))
        require(record.get("schema") == SCHEMA and record.get("source") == source,
                "Continue the original receiving input and mapping")
    else:
        record = {"schema": SCHEMA, "state": "PREPARED", "created_at": now(),
                  "source": source, "steps": {}, "directory": str(directory)}
        dump(record_path, record, exclusive=True)

    def keep(name, value):
        record["steps"][name] = value
        record["updated_at"] = now()
        dump(record_path, record)
        print(json.dumps({"step": name, "state": "COMPLETE"}), flush=True)
        return value

    def retained(name, route, body, request):
        saved = record["steps"].get(name)
        if saved:
            return request("/api/exports/" + quote(saved["export_id"], safe=""))
        request_id = sha((SCHEMA + ":" + str(directory) + ":" + name).encode())[:32]
        result = request(route, {**body, "request_id": request_id})
        keep(name, {"request_id": request_id, "export_id": result["export_id"],
                    "directory": result["directory"]})
        return request("/api/exports/" + quote(result["export_id"], safe=""))

    workspace = DuckDBWorkspace(directory / "warehouse", memory_limit="128MB", threads=1)
    try:
        with opened(workspace, directory) as request:
            identity = request("/api/identity")
            if record.get("workspace_id"):
                require(record["workspace_id"] == identity["workspace_id"], "Original warehouse changed")
            record["workspace_id"] = identity["workspace_id"]
            inspected = request("/api/inspect-delivery", {"report_path": str(report)})
            require(inspected.get("semantics") is not None, "This receiving workflow needs a source dictionary")
            if args.expected_rows is not None:
                require(inspected["row_count"] == args.expected_rows, "Original source row count changed")
            if args.expected_semantics:
                require(inspected["semantics"]["semantic_sha256"] == args.expected_semantics,
                        "Original source meaning changed")
            columns = [dict(column) for column in inspected["default_columns"]]
            selected = next((column for column in columns if column["source"] == args.source_column), None)
            require(selected is not None, "Select an actual published source column")
            selected["name"] = args.sql_column
            review = request("/api/reviews", {"report_path": str(report), "columns": columns,
                                              "keys": [args.sql_column]})
            edition = request("/api/import", {"review_id": review["review_id"]})
            keep("edition", {"edition_id": edition["edition_id"], "rows": edition["row_count"],
                             "manifest_sha256": edition["manifest_sha256"],
                             "semantics": edition["semantics"]})
            edition_id = edition["edition_id"]
            context = request("/api/editions/" + edition_id + "/semantics")
            original, _ = request("/api/editions/" + edition_id + "/semantics-file", raw=True)
            require(sha(original) == context["file"]["sha256"] and len(original) == context["file"]["bytes"],
                    "Original dictionary download changed")
            require(next(item for item in context["columns"] if item["source"] == args.source_column)["column"]
                    == args.sql_column, "Reviewed SQL alias lost its meaning")
            write(directory / "semantics.json", original)
            keep("dictionary", {"bytes": len(original), "sha256": sha(original),
                                "semantic_sha256": context["semantic_sha256"],
                                "definition_sha256": context["definition_sha256"],
                                "capture_manifest_sha256": context["capture_manifest_sha256"]})

            current = request("/api/state")
            view = next((view for view in current["views"] if view["name"] == args.view), None)
            request("/api/activate", {"name": args.view, "edition_id": edition_id,
                    "expected_revision": view["revision"] if view else 0})
            sql = 'SELECT * FROM "' + args.view.replace('"', '""') + '" ORDER BY sf_row'
            preview = request("/api/query", {"sql": sql, "parameters": [], "max_rows": 100})
            source_editions = preview["source_meanings"]["editions"]
            require([item["edition_id"] for item in source_editions] == [edition_id],
                    "Query source meaning did not follow the imported edition")
            require(source_editions[0]["semantics"]["semantic_sha256"] == context["semantic_sha256"],
                    "Query source definition changed")
            current = request("/api/state")
            query = next((query for query in current["queries"] if query["name"] == "source_meaning_receiving"), None)
            query = request("/api/queries", {"name": "source_meaning_receiving", "sql": sql,
                    "parameters": [], "expected_revision": query["revision"] if query else 0})
            exported = retained("query_export", "/api/exports", {"query_id": query["query_id"],
                    "expected_revision": query["revision"], "expected_views": preview["views"]}, request)
            require(exported["rows"] == edition["row_count"], "Complete query row count changed")
            query_files = receive_files(request, exported, directory / "downloaded-query")
            require(any(item["name"] == "source-meanings/" + edition_id + ".json"
                        and item["sha256"] == sha(original) for item in query_files),
                    "Full query receiving did not retain the original dictionary")
            keep("query_receiving", {"rows": exported["rows"], "query_id": query["query_id"],
                    "source_meanings": exported["source_meanings"], "files": query_files})

            if args.compare_column:
                altered = [dict(column) for column in columns]
                column = next((column for column in altered if column["source"] == args.compare_column), None)
                require(column is not None and column["source"] != args.source_column,
                        "Select a different source column for mapping comparison")
                names = {item["name"].casefold() for item in altered}
                alias = "compared_" + column["name"]
                while alias.casefold() in names:
                    alias = "c_" + alias
                require(len(alias) <= 128, "Comparison alias is too long")
                column["name"] = alias
                second = request("/api/reviews", {"report_path": str(report), "columns": altered,
                                                  "keys": [args.sql_column]})
                second = request("/api/import", {"review_id": second["review_id"]})
                comparison = request("/api/compare-meanings", {"before_id": edition_id,
                                     "after_id": second["edition_id"]})
                require(comparison["mapping_changed"] and not comparison["definition_changed"]
                        and not comparison["capture_changed"], "Mapping comparison changed source identity")
                row_comparison = request("/api/compare", {"before_id": edition_id,
                         "after_id": second["edition_id"], "keys": [args.sql_column], "max_rows": 100})
                require(row_comparison["source_meanings"] == {key: value for key, value in comparison.items()
                            if key not in {"before_id", "after_id"}},
                        "Row comparison lost the source-definition context")
                keep("comparison", {"candidate": second["edition_id"], "definitions": comparison,
                                    "rows": row_comparison["summary"]})

            source_export = retained("source_handoff", "/api/source-handoffs",
                                     {"edition_id": edition_id}, request)
            source_files = receive_files(request, source_export, directory / "downloaded-source")
            require(any(item["name"] == "semantics.json" and item["sha256"] == sha(original)
                        for item in source_files), "Source handoff dictionary changed")
            keep("source_receiving", {"files": source_files})
            handoff = retained("warehouse_handoff", "/api/handoffs", {}, request)
            portable = directory / "portable"
            portable_files = receive_files(request, handoff, portable)
            keep("portable_receiving", {"directory": str(portable), "files": portable_files})
        workspace.close()

        with DuckDBWorkspace(directory / "portable", memory_limit="128MB", threads=1) as received:
            require(received.identity()["workspace_id"] == record["workspace_id"],
                    "Portable warehouse identity changed")
            require(received.semantics_bytes(edition_id) == original,
                    "Portable warehouse did not retain exact dictionary bytes")
            result = received.query(sql, max_rows=100)
            require(result["source_meanings"]["editions"][0]["semantics"] == context_without_document(context),
                    "Portable query source mapping changed")
            keep("portable_reopen", {"workspace_id": received.identity()["workspace_id"],
                    "edition_id": edition_id, "preview_rows": len(result["rows"]),
                    "dictionary_sha256": sha(received.semantics_bytes(edition_id))})
        with DuckDBWorkspace(directory / "warehouse", memory_limit="128MB", threads=1) as reopened:
            require(reopened.semantics_bytes(edition_id) == original, "Original reopened dictionary changed")
            result = reopened.query(sql, max_rows=100)
            keep("original_reopen", {"workspace_id": reopened.identity()["workspace_id"],
                    "preview_rows": len(result["rows"]), "source_meanings": result["source_meanings"]})
        record["state"] = "COMPLETE"
        record["completed_at"] = now()
        dump(record_path, record)
        if args.archive:
            archive = Path(args.archive).expanduser().absolute()
            private_directory(archive.parent)
            require(not archive.exists(), "Receiving archive already exists")
            roots = [directory / "receiving.json", directory / "semantics.json",
                     directory / "downloaded-query", directory / "downloaded-source", directory / "portable"]
            with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as output:
                for root in roots:
                    for path in sorted(root.rglob("*")) if root.is_dir() else [root]:
                        if path.is_file():
                            output.write(path, path.relative_to(directory).as_posix())
            archive.chmod(0o600)
        print(json.dumps({"state": record["state"], "receiving": str(record_path),
                          "workspace_id": record["workspace_id"], "rows": edition["row_count"],
                          "dictionary_sha256": sha(original)}, ensure_ascii=False), flush=True)
        return record
    except BaseException as error:
        record["state"] = "INTERRUPTED"
        record["error"] = getattr(error, "code", type(error).__name__)
        record["updated_at"] = now()
        dump(record_path, record)
        raise
    finally:
        workspace.close()


def context_without_document(context):
    return {key: value for key, value in context.items()
            if key not in {"document", "version_id", "edition_id"}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--source-column", default="observation_id")
    parser.add_argument("--sql-column", default="observation_key")
    parser.add_argument("--compare-column", default=None)
    parser.add_argument("--view", default="svk_capacity")
    parser.add_argument("--expected-rows", type=int)
    parser.add_argument("--expected-semantics")
    parser.add_argument("--archive", help="Optional new ZIP path for received data, dictionaries and portable warehouse")
    run(parser.parse_args())


if __name__ == "__main__":
    main()

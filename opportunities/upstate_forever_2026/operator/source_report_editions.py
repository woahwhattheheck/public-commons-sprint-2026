"""Saved standalone scientific editions on the original operator queue and file transport."""
from __future__ import annotations

from pathlib import Path, PurePosixPath
from urllib.parse import quote

from model.common import (atomic_json, describe_file, digest, held, identifier,
                          read_json, relative_file, verify_file)
from model import scientific_briefing
from model import observed_context
from model import scientific_report_editions as retained_editions
from model import scientific_report_review

KIND = "scientific-report-editions"
SCHEMA = "upstate.scientific-report-edition/v1"
ACTIONS = frozenset({"source-reports.render", "source-reports.export", "source-reports.briefing", "source-reports.review"})


class ScientificReportEditions:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _directory(self, workspace, key):
        return retained_editions.directory(workspace, key)

    def _record(self, workspace, key):
        return retained_editions.record(workspace, key)

    def _inspect(self, workspace, key):
        return retained_editions.inspect(workspace, key)

    @staticmethod
    def _summary(record):
        return {name: record[name] for name in (
            "id", "title", "state", "operation_id", "source_count", "section_count",
            "figure_count", "sources")}

    def saved(self, workspace):
        folder = self.operator.ws(workspace).root / KIND
        rows = []
        for path in sorted(folder.glob("*/edition.json")):
            record, _ = self._record(self.operator.ws(workspace), path.parent.name)
            rows.append(self._summary(record))
        return rows

    def catalog(self, workspace):
        rows = []
        for collection in self.operator.ws(workspace).sources():
            for entry in collection.get("entries", []):
                metadata = entry.get("metadata") or {}
                if (entry.get("kind") == "document"
                        and (metadata.get("report_schema") == observed_context.SCHEMA
                             or entry.get("role") == observed_context.ROLE)):
                    rows.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                                 "title": entry["title"], "vintage": entry["vintage"],
                                 "uri": entry["uri"], "body_sha256": entry["body"]["sha256"],
                                 "body_bytes": entry["body"]["bytes"],
                                 "collection_title": collection.get("title", collection["id"])})
        return {"workspace_key": workspace, "sources": rows, "editions": self.saved(workspace)}

    def preview(self, workspace, payload):
        result = retained_editions.preview(self.operator.ws(workspace), payload)
        return {"workspace_key": workspace, **result}

    def render(self, workspace, payload):
        try:
            return retained_editions.render(self.operator.ws(workspace), payload)
        except retained_editions.PreviewChanged as error:
            raise self.Fault("SCIENTIFIC_REPORT_PREVIEW", str(error), 409) from error

    def _files(self, record, directory):
        return retained_editions.files(record, directory)

    def _url(self, workspace, key, name):
        return "/api/file/scientific-reports/" + "/".join(
            quote(str(part), safe="") for part in (workspace, key)) + "/" + quote(name, safe="/")

    def detail(self, workspace, key):
        ws = self.operator.ws(workspace)
        record, directory, result = self._inspect(ws, identifier(key))
        members = [{"role": role, **item,
                    "url": self._url(workspace, key, item["path"])}
                   for role, item in self._files(record, directory).items()]
        archive = None
        receipt = directory / "report-files.json"
        if receipt.is_file():
            item = read_json(receipt)["file"]
            verify_file(directory, item)
            archive = self.operator._ticket(workspace, directory / item["path"], item, "Complete report ZIP")
        return {"workspace_key": workspace, "edition": record, "files": members, "archive": archive,
                "briefings": self.briefing_catalog(workspace, key),
                "viewer_url": next((row["url"] for row in members
                                    if row["role"] == "report_html"), None),
                "_downloads": [self.operator._ticket(workspace, relative_file(directory, row["path"]),
                                                       row, row["role"]) for row in members]}

    def member(self, workspace, key, name):
        ws = self.operator.ws(workspace)
        record, directory, _ = self._inspect(ws, identifier(key))
        allowed = {row["path"]: row for row in self._files(record, directory).values()}
        if name not in allowed:
            raise self.Fault("SCIENTIFIC_REPORT_MEMBER", "Choose a file in this saved report.", 404)
        item = allowed[name]
        path = relative_file(directory, name)
        return self.operator._ticket(workspace, path, item, name), path

    def export(self, workspace, key):
        result = retained_editions.export(self.operator.ws(workspace), identifier(key))
        item = result["file"]
        return {"scientific_report_edition_id": result["scientific_report_edition_id"],
                "state": result["state"],
                "download": self.operator._ticket(
                    workspace, Path(result["directory"]) / item["path"], item,
                    result["title"] + " — complete report files")}


    def briefing_catalog(self, workspace, source_edition_id):
        root = self.operator.ws(workspace).root / scientific_briefing.KIND
        rows = []
        for path in sorted(root.glob("*/briefing.json")):
            record = read_json(path)
            if record.get("source_edition_id") == source_edition_id:
                rows.append({name: record[name] for name in
                    ("id", "title", "source_edition_id", "page_count", "source_count", "figure_count")})
        return rows

    def briefing_preview(self, workspace, payload):
        result = scientific_briefing.preview(self.operator.ws(workspace), identifier(payload.get("id")))
        return {"workspace_key": workspace, **result}

    def briefing_prepare(self, workspace, payload):
        ws = self.operator.ws(workspace)
        record = scientific_briefing.create(ws, identifier(payload.get("id")),
                                            expected_id=payload.get("preview_id"))
        scientific_briefing.export(ws, record["id"])
        return {"scientific_report_edition_id": record["source_edition_id"],
                "scientific_briefing_id": record["id"], "state": "complete",
                "title": record["title"], "page_count": record["page_count"]}

    def briefing_detail(self, workspace, key):
        ws = self.operator.ws(workspace)
        record, directory, members = scientific_briefing.members(ws, identifier(key))
        def url(name):
            return "/api/file/scientific-briefings/" + "/".join(
                quote(str(part), safe="") for part in (workspace, key)) + "/" + quote(name, safe="/")
        files = [{field: item[field] for field in ("path", "bytes", "sha256")}
                 for item in members.values()]
        for row in files:
            row["url"] = url(row["path"])
        receipt = directory / "archive.json"
        archive = None
        if receipt.exists():
            descriptor = read_json(receipt)["file"]
            path = verify_file(directory, descriptor)
            archive = self.operator._ticket(workspace, path, descriptor, "Complete scientific briefing ZIP")
        generated = [self.operator._ticket(workspace, verify_file(directory, row), row, role)
                     for role, row in record["files"].items()]
        return {"workspace_key": workspace, "briefing": record, "files": files,
                "viewer_url": url(record["files"]["html"]["path"]), "archive": archive,
                "_downloads": ([archive] if archive else []) + generated}

    def briefing_member(self, workspace, key, name):
        ws = self.operator.ws(workspace)
        _, _, members = scientific_briefing.members(ws, identifier(key))
        if name not in members:
            raise self.Fault("SCIENTIFIC_BRIEFING_MEMBER", "Choose a retained briefing or original report file.", 404)
        descriptor = members[name]
        path = Path(descriptor["source"])
        return self.operator._ticket(workspace, path, descriptor, name), path


    def review_preview(self, workspace, payload):
        result = scientific_report_review.preview_review(
            self.operator.ws(workspace), payload.get("edition_id"),
            payload.get("review_selection"))
        return {**result, "workspace_key": workspace}

    def review(self, task):
        payload = task["payload"]
        return scientific_report_review.create_review(
            self.operator.ws(task["workspace"]), payload.get("edition_id"),
            payload.get("review_selection"),
            expected_operation_id=payload.get("expected_operation_id"),
            created_at=task["created_at"])

    def read(self, workspace, operation, payload):
        if operation == "scientific-review-preview":
            return self.review_preview(workspace, payload)
        if operation == "scientific-briefing-preview":
            return self.briefing_preview(workspace, payload)
        if operation == "scientific-briefing":
            return self.briefing_detail(workspace, payload.get("id"))
        if operation == "scientific-catalog":
            return self.catalog(workspace)
        if operation == "scientific-preview":
            return self.preview(workspace, payload)
        if operation == "scientific-edition":
            return self.detail(workspace, payload.get("id"))
        raise self.Fault("SCIENTIFIC_REPORT_READ", "Choose a saved scientific report operation.", 404)

    def invoke(self, task):
        if task["action"] == "source-reports.review":
            return self.review(task)
        if task["action"] == "source-reports.briefing":
            return self.briefing_prepare(task["workspace"], task["payload"])
        if task["action"] == "source-reports.render":
            return self.render(task["workspace"], task["payload"])
        if task["action"] == "source-reports.export":
            return self.export(task["workspace"], task["payload"].get("id"))
        raise self.Fault("SCIENTIFIC_REPORT_ACTION", "Choose a scientific report task.")

    def state(self, workspace):
        return {"scientific_report_editions": self.saved(workspace)}

    def verify_workspace(self, workspace):
        rows = []
        for path in sorted((workspace.root / KIND).glob("*/edition.json")):
            record, _, _ = self._inspect(workspace, path.parent.name)
            rows.append({"id": record["id"], "source_count": record["source_count"]})
        briefings = []
        for path in sorted((workspace.root / scientific_briefing.KIND).glob("*/briefing.json")):
            record, _ = scientific_briefing.inspect(workspace, path.parent.name)
            briefings.append({"id": record["id"], "source_edition_id": record["source_edition_id"]})
        return {"scientific_report_editions": rows, "verified_count": len(rows),
                "scientific_briefings": briefings}

    def decorate_task(self, task):
        if task["state"] != "complete" or task["action"] not in ACTIONS:
            return task
        result = task.get("result") or {}
        if task["action"] == "source-reports.review":
            return {**task, "_review": {
                "kind": "review", "review_id": result["review_id"],
                "scientific_report_edition_id": result["scientific_report_edition_id"],
                "title": result["title"], "artifact_count": result["artifact_count"]}}
        key = result.get("scientific_report_edition_id")
        if not key:
            return task
        if task["action"] == "source-reports.briefing":
            downloads = self.briefing_detail(task["workspace"], result["scientific_briefing_id"])["_downloads"]
        elif task["action"] == "source-reports.export":
            completed = self.detail(task["workspace"], key)
            downloads = [completed["archive"]] if completed["archive"] else []
        else:
            downloads = self.detail(task["workspace"], key)["_downloads"]
        return {**task, "_downloads": downloads}

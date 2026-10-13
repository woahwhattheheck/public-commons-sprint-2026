"""Native operator provider for complete published field-study context."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any
from urllib.parse import quote

from model.common import describe_file, held, verify_file
from measurement_workspace.study_reviews import PublishedStudyReviews
from measurement_workspace.source_observations import builtin_companion
from measurement_workspace import utility_microbiology as microbial
from measurement_workspace import sv833_observations as sv833
from measurement_workspace import rl18151_observations as rl18151
from measurement_workspace.published_studies import PublishedStudyStore, TABLE_TITLES, COMPANION_SCHEMA, _manifest_path, INSTALLED_CONTEXT_PATHS

ACTIONS = ("published-study.import", "published-study.export", "published-study.report",
           "published-study.review.save", "published-study.review.export", "published-study.review.import",
           "published-study.review.prepare-source", "published-study.microbial-selection.prepare")
BUILTIN_ID = "scdes-eighteenmile-lake-2023"
BUILTIN_DIRECTORIES = {
    BUILTIN_ID: "eighteenmile_2023",
    "scdes-eighteenmile-streams-2020-2025": "eighteenmile_stream_nutrients_2020_2025",
}
# Interactive original reports use an opaque origin and cannot call the operator.
REPORT_POLICY = ("sandbox allow-scripts allow-downloads allow-modals allow-popups "
                 "allow-popups-to-escape-sandbox; default-src 'none'; "
                 "script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; "
                 "connect-src 'none'; object-src 'none'; base-uri 'none'; "
                 "form-action 'none'; frame-ancestors 'self'")


class PublishedStudyProvider:
    def __init__(self, operator, fault, source_roots=()):
        self.operator, self.Fault = operator, fault
        self.roots = {}
        candidates = [Path(value) for value in source_roots]
        candidates.extend(Path(row["path"]).parent for row in operator.registered.values())
        for candidate in candidates:
            try:
                path = candidate.expanduser().resolve(strict=True)
            except OSError:
                continue
            if path.is_dir():
                root_id = hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:24]
                self.roots[root_id] = path
        self.builtin = Path(__file__).resolve().parent.parent / "observations" / "eighteenmile_2023"

    def _builtin_source(self, builtin_id=BUILTIN_ID):
        if builtin_id == rl18151.BUILTIN_ID:
            return rl18151.builtin_companion(self.builtin.parent.parent)
        if builtin_id == sv833.BUILTIN_ID:
            return sv833.builtin_companion(self.builtin.parent.parent)
        if builtin_id == microbial.BUILTIN_ID:
            return microbial.builtin_companion(self.builtin.parent.parent)
        if builtin_id != BUILTIN_ID:
            directory = BUILTIN_DIRECTORIES.get(builtin_id) if isinstance(builtin_id, str) else None
            if directory is None:
                self._fail("STUDY_BUILTIN", "The installed study source is unavailable.", 404)
            return builtin_companion(self.builtin.parent / directory)
        required = (
            "study.json", "stations.csv", "stations.json", "seasonal_summaries.csv",
            "surface_ranges.csv", "continuous_monthly_do.csv", "continuous_monthly_ph.csv",
            "reported_npdes_permits.csv", "source_notes.json", "README.md",
        )
        selected = {}
        def retain(path, name=None):
            path = path.resolve(strict=True)
            root = self.builtin.resolve(strict=True)
            if name is None:
                if not path.is_relative_to(root):
                    self._fail("STUDY_BUILTIN_PATH", "A study manifest points outside its installed study directory.")
                name = path.relative_to(root).as_posix()
            raw = path.read_bytes()
            if name in selected and selected[name] != raw:
                self._fail("STUDY_BUILTIN_PATH", "Installed source files conflict at " + name)
            selected[name] = raw

        for name in required:
            retain(self.builtin / name)
        for name in (
            "table7-visual-context.csv", "table7-visual-reading.json", "table7-page-render.json",
            "map-layer-capture.json", "NATIVE_IMPORT.md", "wqp/flow-context-sources.json",
            "microcystin_support_20261013/original-campaign-support.json",
        ):
            path = self.builtin / name
            if path.is_file():
                retain(path)
        manifests = (
            self.builtin / "model-sources.json",
            self.builtin / "wqp" / "flow-context-sources.json",
            self.builtin / "wqp" / "flow-context-public-sources.json",
            self.builtin / "wqp_20261013" / "source-manifest.json",
            self.builtin / "figures" / "model-sources.json",
            self.builtin.parent.parent / "eighteenmile_chlorophyll_reconciled.sources.json",
            self.builtin.parent.parent / "eighteenmile_lake_observation_report.sources.json",
            self.builtin.parent.parent / "eighteenmile_lake_paired_analysis.sources.json",
            self.builtin.parent.parent / "eighteenmile_lake_microcystin_reconciliation.sources.json",
        )
        for manifest_path in manifests:
            if not manifest_path.is_file():
                continue
            manifest_name = (
                manifest_path.name if manifest_path.parent == self.builtin.parent.parent
                else manifest_path.relative_to(self.builtin).as_posix()
            )
            retain(manifest_path, manifest_name)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
            if manifest.get("schema") != "upstate.sources/v1":
                self._fail("STUDY_BUILTIN_MANIFEST", "The installed study manifest has an incompatible schema.")
            for entry in manifest.get("entries", []):
                for item in [entry, *entry.get("companions", [])]:
                    try:
                        relative = _manifest_path(manifest_name, item["path"])
                    except (TypeError, ValueError) as error:
                        self._fail("STUDY_BUILTIN_PATH", str(error))
                    retain(self.builtin / relative)
        files, evidence = [], {}
        for name, raw in sorted(selected.items()):
            if Path(name).suffix.lower() in (".pdf", ".png", ".jpg", ".jpeg"):
                evidence[name] = raw
            else:
                files.append({
                    "path": name, "encoding": "utf-8", "bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest(), "content": raw.decode("utf-8"),
                })
        for name in (
            "2023LakeProgramFinalReport.pdf", "scdes-2023-lake-program-original.pdf",
            "table7-page21.png", "table7-crop.png",
        ):
            path = self.builtin / name
            if path.is_file():
                evidence[name] = path.read_bytes()
        return json.dumps({"schema": COMPANION_SCHEMA, "files": files}, ensure_ascii=False).encode("utf-8"), evidence

    def _fail(self, code, message, status=422):
        raise self.Fault(code, message, status)

    def _store(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        return ws, PublishedStudyStore(ws, ws.root / "published_studies")

    def _root_path(self, root_id, relative):
        team = getattr(self.operator, "team", None)
        context = team.current() if team else None
        if context:
            team.require(context["principal"], administrator=True)
        root = self.roots.get(root_id)
        if root is None:
            self._fail("STUDY_SOURCE_ROOT", "Choose an available study source folder.", 404)
        if not isinstance(relative, str) or not relative or "\\" in relative or "\x00" in relative:
            self._fail("STUDY_SOURCE_PATH", "Enter a relative source file or study directory.")
        path = PurePosixPath(relative)
        if path.is_absolute() or ".." in path.parts or str(path) != relative:
            self._fail("STUDY_SOURCE_PATH", "The source must remain inside the selected folder.")
        try:
            resolved = root.joinpath(*path.parts).resolve(strict=True)
        except OSError:
            self._fail("STUDY_SOURCE_PATH", "That source path is unavailable.", 404)
        if not resolved.is_relative_to(root) or not (resolved.is_file() or resolved.is_dir()):
            self._fail("STUDY_SOURCE_PATH", "Choose a file or directory inside the selected source folder.")
        return resolved

    def _source_path(self, ws, selector):
        if not isinstance(selector, dict):
            self._fail("STUDY_SOURCE", "A retained source or source folder selection is required.")
        collection_id = selector.get("source_collection_id") or selector.get("collection_id")
        if collection_id:
            source_id = selector.get("source_id")
            if not isinstance(collection_id, str) or not isinstance(source_id, str):
                self._fail("STUDY_SOURCE", "A retained source requires its collection and source identifiers.")
            path, _ = ws.source_file(collection_id, source_id)
            return path
        return self._root_path(selector.get("root_id"), selector.get("relative_path"))

    def _filters(self, payload):
        selection = payload.get("selection") or {}
        if not isinstance(selection, dict):
            self._fail("STUDY_SELECTION", "Study selection must be an object.")
        result = {}
        for key in ("site_ids", "parameters", "strata"):
            value = selection.get(key)
            if value is not None:
                if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                    self._fail("STUDY_SELECTION", key + " must contain text values.")
                result[key] = value
        if selection.get("year") is not None:
            year = selection["year"]
            if isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= 2200:
                self._fail("STUDY_SELECTION", "Choose a valid year.")
            result["year"] = year
        if selection.get("months") is not None:
            months = selection["months"]
            if not isinstance(months, list) or any(
                isinstance(month, bool) or not isinstance(month, int) or not 1 <= month <= 12
                for month in months
            ):
                self._fail("STUDY_SELECTION", "Months must be whole numbers from 1 through 12.")
            result["months"] = months
        return result

    def _selection(self, payload):
        study_id = payload.get("study_id")
        version_id = payload.get("version_id")
        if not isinstance(study_id, str) or not study_id:
            self._fail("STUDY_ID", "Choose a published study.")
        if version_id is not None and not isinstance(version_id, str):
            self._fail("STUDY_VERSION", "A study version must be text.")
        return study_id, version_id

    def _artifact(self, ws, path, label):
        path = Path(path).resolve(strict=True)
        if not path.is_relative_to(ws.root):
            self._fail("STUDY_EXPORT_PATH", "A study export must remain in its workspace.", 500)
        item = describe_file(ws.root, path)
        return {**item, "path": str(path.relative_to(ws.root)), "filename": path.name, "label": label}

    def _ticket(self, workspace_key, ws, path, label):
        return self.operator._ticket(workspace_key, path, describe_file(ws.root, path), label)

    def _source_links(self, workspace_key, ws, store, result):
        record = result["record"]
        prefix = "/api/file/published-study/" + "/".join(
            quote(str(part), safe="") for part in (workspace_key, record["source_collection_id"])
        ) + "/"
        reports = []
        for artifact in result.get("source_artifacts", []):
            path, _ = store.source_file(record["study_id"], artifact["path"], record["version_id"])
            artifact["download"] = self._ticket(workspace_key, ws, path, artifact["path"])
            artifact["member_url"] = prefix + quote(artifact["path"], safe="/")
            if PurePosixPath(artifact["path"]).suffix.lower() in (".html", ".htm"):
                artifact["preview_url"] = artifact["member_url"]
                reports.append({
                    "path": artifact["path"], "url": artifact["preview_url"],
                    "download": artifact["download"], "sha256": artifact["sha256"],
                    "bytes": artifact["bytes"], "title": artifact.get("title"),
                    "role": artifact.get("role"), "source_metadata": artifact.get("source_metadata", {}),
                })
        result["retained_reports"] = reports
        return result

    def member(self, workspace_key, collection_id, member_path):
        """Open exact original report members through the existing file transport."""
        if not re.fullmatch(r"[0-9a-f]{64}", collection_id or ""):
            self._fail("STUDY_COLLECTION", "Choose a retained study source collection.", 404)
        ws, store = self._store(workspace_key)
        try:
            records = [
                record for record in store.list_studies()["studies"]
                if record.get("source_collection_id") == collection_id
            ]
            if len(records) != 1:
                self._fail("STUDY_COLLECTION", "That retained study source collection is unavailable.", 404)
            record = records[0]
            # source_file accepts only registered inventory members and verifies
            # their original content-addressed bodies before issuing the ticket.
            path, _ = store.source_file(record["study_id"], member_path, record["version_id"])
            return self._ticket(workspace_key, ws, path, member_path), REPORT_POLICY
        except KeyError as error:
            self._fail("STUDY_MEMBER", str(error), 404)
        except (ValueError, OSError) as error:
            self._fail("STUDY_SOURCE", str(error))

    def read(self, workspace_key, operation, payload):
        payload = payload or {}
        if not isinstance(payload, dict):
            self._fail("STUDY_REQUEST", "Study request must be an object.")
        ws, store = self._store(workspace_key)
        try:
            if operation in ("microbial-selection-catalog", "microbial-selection-preview"):
                from measurement_workspace import microbial_selection
                return (microbial_selection.catalog(ws) if operation == "microbial-selection-catalog"
                        else microbial_selection.preview(ws, payload))
            if operation == "catalog":
                builtin = []
                for builtin_id, directory in BUILTIN_DIRECTORIES.items():
                    source = self.builtin.parent / directory / "study.json"
                    if source.is_file():
                        metadata = json.loads(source.read_text(encoding="utf-8-sig"))
                        builtin.append({
                            "id": builtin_id, "title": metadata["title"],
                            "publication": metadata.get("publication"),
                            "counts": metadata.get("content_counts", {}),
                        })
                rl18151_source = rl18151.catalog_entry(self.builtin.parent.parent)
                if rl18151_source:
                    builtin.append(rl18151_source)
                sv833_source = sv833.catalog_entry(self.builtin.parent.parent)
                if sv833_source:
                    builtin.append(sv833_source)
                microbial_source = microbial.catalog_entry(self.builtin.parent.parent)
                if microbial_source:
                    builtin.append(microbial_source)
                return {
                    **store.list_studies(),
                    "reviews": PublishedStudyReviews(store).catalog(),
                    "builtin_studies": builtin,
                    "source_roots": [{"id": key, "label": str(path)} for key, path in self.roots.items()],
                    "table_titles": TABLE_TITLES,
                }
            if operation in ("geographic-preview", "geographic-selection"):
                from measurement_workspace import geographic_study_selection as geographic
                if operation == "geographic-preview":
                    return geographic.preview(ws, store, payload)
                result = geographic.resolve(ws, store, payload)
                result["study"] = self._source_links(workspace_key, ws, store, result["study"])
                result["context"] = self._source_links(workspace_key, ws, store, result["context"])
                return result
            if operation in ("review-source-preview", "review-sources", "review-source"):
                from model import published_review_report_source as scientific
                if operation == "review-source-preview":
                    return scientific.preview(ws, payload.get("review_id"))
                if operation == "review-sources":
                    result = scientific.catalog(ws, review_id=payload.get("review_id"))
                    return {"review_id": payload.get("review_id"), "sources": result["items"]}
                return scientific.inspect(ws, payload.get("id"))
            if operation == "review":
                result = PublishedStudyReviews(store).get(payload.get("review_id"))
                result["context"] = self._source_links(workspace_key, ws, store, result["context"])
                return result
            study_id, version_id = self._selection(payload)
            if operation == "study":
                return self._source_links(workspace_key, ws, store, store.get_study(study_id, version_id))
            if operation == "context":
                result = store.context(study_id, version_id, **self._filters(payload))
                return self._source_links(workspace_key, ws, store, result)
            self._fail("STUDY_OPERATION", "Unknown published-study read operation.", 404)
        except KeyError as error:
            self._fail("STUDY_NOT_FOUND", str(error), 404)
        except (ValueError, OSError) as error:
            self._fail("STUDY_SOURCE", str(error))

    def invoke(self, task):
        workspace_key = task["workspace"]
        ws, store = self._store(workspace_key)
        payload = task.get("payload") or {}
        action = task["action"]
        if not isinstance(payload, dict):
            self._fail("STUDY_REQUEST", "Study task payload must be an object.")
        try:
            if action == "published-study.microbial-selection.prepare":
                from measurement_workspace import microbial_selection
                return microbial_selection.prepare(ws, store, payload, operation_id=task["operation_id"])
            if action == "published-study.import":
                evidence = {}
                builtin_id = payload.get("builtin_id")
                if builtin_id is not None:
                    if builtin_id == rl18151.BUILTIN_ID:
                        available = rl18151.catalog_entry(self.builtin.parent.parent) is not None
                    elif builtin_id == sv833.BUILTIN_ID:
                        available = sv833.catalog_entry(self.builtin.parent.parent) is not None
                    elif builtin_id == microbial.BUILTIN_ID:
                        available = microbial.catalog_entry(self.builtin.parent.parent) is not None
                    else:
                        directory = BUILTIN_DIRECTORIES.get(builtin_id) if isinstance(builtin_id, str) else None
                        available = directory is not None and (self.builtin.parent / directory / "study.json").is_file()
                    if not available:
                        self._fail("STUDY_BUILTIN", "The installed study source is unavailable.", 404)
                    source, evidence = self._builtin_source(builtin_id)
                elif isinstance(payload.get("source_json"), str):
                    source = payload["source_json"].encode("utf-8")
                else:
                    source = self._source_path(ws, payload.get("source"))
                for item in payload.get("evidence") or []:
                    path = self._source_path(ws, item.get("source"))
                    if not path.is_file():
                        self._fail("STUDY_EVIDENCE", "Original report evidence must be a file.")
                    name = item.get("filename") or path.name
                    if name in evidence:
                        self._fail("STUDY_EVIDENCE", "Each report evidence filename must be unique.")
                    evidence[name] = path.read_bytes()
                include_context = payload.get("include_installed_context", False)
                if not isinstance(include_context, bool):
                    self._fail("STUDY_REQUEST", "Choose whether to include the installed study context.")
                context_application = (
                    self.builtin.parent.parent
                    if include_context or builtin_id == "scdes-eighteenmile-streams-2020-2025"
                    else None
                )
                result = store.import_source(
                    source, evidence=evidence, operation_id=task["operation_id"],
                    context_application=context_application,
                )
                record = result["record"]
                manifest_path = Path(record["source_manifest"]["path"])
                return {
                    **result,
                    "study_id": record["study_id"], "version_id": record["version_id"],
                    "view": "published-studies",
                    "artifacts": [self._artifact(ws, manifest_path, "Study context source manifest")],
                }
            if action == "published-study.review.prepare-source":
                from model import published_review_report_source as scientific
                with held(ws.root / ".workspace.lock", blocking=False):
                    result = scientific.prepare(
                        ws, payload.get("review_id"),
                        expected_preview_id=payload.get("expected_preview_id"))
                directory = ws.root / scientific.FOLDER / result["id"]
                artifacts = []
                for name, item in result["files"].items():
                    path = verify_file(directory, item)
                    artifacts.append(self._artifact(ws, path, "Saved review scientific source: " + name))
                return {**result, "view": "published-studies", "artifacts": artifacts}
            if action.startswith("published-study.review."):
                reviews = PublishedStudyReviews(store)
                if action == "published-study.review.save":
                    result = reviews.save(payload)
                    artifacts = [self._artifact(ws, reviews._path(result["review"]["id"]), "Exact saved study review")]
                elif action == "published-study.review.import":
                    result = reviews.receive(self._source_path(ws, payload.get("source")),
                                             operation_id=task["operation_id"])
                    artifacts = [self._artifact(ws, reviews._path(result["review"]["id"]), "Received exact study review")]
                elif action == "published-study.review.export":
                    task_id = task["id"]
                    if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", task_id):
                        self._fail("STUDY_TASK", "The queued task has an invalid identifier.", 500)
                    result = reviews.export(payload.get("review_id"), ws.root / "published_study_exports" / task_id)
                    artifacts = [self._artifact(ws, path, "Complete saved review and original sources" if path.suffix == ".zip" else "Exact saved review selection")
                                 for path in result.pop("files")]
                else:
                    self._fail("STUDY_ACTION", "Unknown saved-review task.", 404)
                body = result["review"]["content"]
                return {**result, **{key: body["binding"][key] for key in ("study_id", "version_id")},
                        "selection": body["selection"], "table": body["table"],
                        "view": "published-studies", "artifacts": artifacts}
            study_id, version_id = self._selection(payload)
            task_id = task["id"]
            if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", task_id):
                self._fail("STUDY_TASK", "The queued task has an invalid identifier.", 500)
            destination = ws.root / "published_study_exports" / task_id
            if action == "published-study.export":
                exported = store.export_study(study_id, destination / "published-study.zip", version_id)
                return {
                    "study_id": study_id, "version_id": exported["version_id"],
                    "view": "published-studies",
                    "artifacts": [self._artifact(ws, Path(exported["path"]), "Complete study and original sources")],
                }
            if action == "published-study.report":
                report = store.export_context(study_id, destination, version_id, **self._filters(payload))
                return {
                    "study_id": study_id, "version_id": report["version_id"],
                    "selection": report["selection"], "view": "published-studies",
                    "artifacts": [
                        self._artifact(ws, Path(item["path"]), item.get("relative_path", item["filename"]))
                        for item in report["files"]
                    ],
                }
            self._fail("STUDY_ACTION", "Unknown published-study task.", 404)
        except KeyError as error:
            self._fail("STUDY_NOT_FOUND", str(error), 404)
        except (ValueError, OSError) as error:
            self._fail("STUDY_SOURCE", str(error))

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or not isinstance(task.get("result"), dict):
            return task
        ws = self.operator.ws(task["workspace"])
        downloads = list(task.get("_downloads") or [])
        for item in task["result"].get("artifacts", []):
            relative = item.get("path", "")
            path = (ws.root / relative).resolve(strict=True)
            if not path.is_relative_to(ws.root):
                self._fail("STUDY_EXPORT_PATH", "A recorded study export is outside its workspace.", 500)
            downloads.append(self.operator._ticket(task["workspace"], path, item, item.get("label")))
        task["_downloads"] = downloads
        return task

"""Original document/job controls and a portable source for native Analysis."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import stat
import tempfile

from .errors import StateError
from .result import FileDelivery
from .runtime import Runtime, CLI
from .storage import digest, dump, parse, private_directory, read, sync_directory
from .research_workspace import _CALL, _LIMIT, _HASH, _value, _file_delivery

_SOURCE_RECEIPT = "stellar-forge.research-document-analysis.v1"


def _pin_file(path, maximum):
    path = Path(path).expanduser().absolute()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or not 0 <= before.st_size <= maximum:
            raise StateError("RESEARCH_SELECTED_FILE_INVALID")
        checksum = hashlib.sha256()
        count = 0
        while block := stream.read(1024 * 1024):
            count += len(block)
            if count > maximum:
                raise StateError("RESEARCH_SELECTED_FILE_CHANGED")
            checksum.update(block)
        after = os.fstat(stream.fileno())
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if count != before.st_size or any(getattr(before, key) != getattr(after, key) for key in fields):
            raise StateError("RESEARCH_SELECTED_FILE_CHANGED")
    return {"file": str(path), "bytes": count, "sha256": checksum.hexdigest()}


@dataclass(frozen=True)
class ResearchInputFile:
    file: Path
    sha256: str
    filename: str | None = None
    content_type: str | None = None

    @classmethod
    def from_file(cls, file, *, filename=None, content_type=None):
        pin = _pin_file(file, 50_000_000)
        return cls(Path(pin["file"]), pin["sha256"], filename, content_type)

    def as_request(self):
        if not isinstance(self.sha256, str) or not _HASH.fullmatch(self.sha256):
            raise StateError("RESEARCH_SELECTED_FILE_DIGEST_REQUIRED")
        value = {"file": str(Path(self.file).expanduser().absolute()), "sha256": self.sha256}
        if self.filename is not None:
            value["filename"] = self.filename
        if self.content_type is not None:
            value["contentType"] = self.content_type
        return value


class ResearchDocuments:
    def __init__(self, workspace, dossier_id):
        self.workspace, self.dossier_id = workspace, dossier_id

    def list(self, **options):
        return self.workspace._read("documents-list", {"dossierId": self.dossier_id, "options": options})

    def purchase(self, purchase_id):
        return ResearchSelection(self.workspace, self.dossier_id, "documents", {"purchaseId": purchase_id})

    def edition(self, edition_id):
        return ResearchSelection(self.workspace, self.dossier_id, "documents", {"editionId": edition_id})


class ResearchPipelines:
    def __init__(self, workspace, dossier_id):
        self.workspace, self.dossier_id = workspace, dossier_id

    def list(self, **options):
        return self.workspace._read("pipelines-list", {"dossierId": self.dossier_id, "options": options})

    def operation(self, operation_id):
        return self.workspace._read("pipelines-operation", {
            "dossierId": self.dossier_id, "operationId": operation_id})

    def prepare_files(self, *, request_id, profile_id, question_id, label, expected_revision, files):
        body = {"requestId": request_id, "profileId": profile_id, "questionId": question_id,
                "label": label, "expectedRevision": expected_revision,
                "files": [file.as_request() if isinstance(file, ResearchInputFile) else deepcopy(file) for file in files]}
        return self.workspace._write("pipelines-prepare", {"dossierId": self.dossier_id, "body": body},
                                     request_id=request_id, replay_safe=True)

    def _action(self, action, operation_id, request_id, expected_revision, **body):
        value = {"requestId": request_id, "expectedRevision": expected_revision, **body}
        return self.workspace._write("pipelines-" + action, {
            "dossierId": self.dossier_id, "operationId": operation_id, "body": value},
            request_id=request_id, replay_safe=True)

    def submit(self, operation_id, *, request_id, expected_revision, expected_plan_sha256):
        return self._action("submit", operation_id, request_id, expected_revision,
                            expectedPlanSha256=expected_plan_sha256)

    def refresh(self, operation_id, *, request_id, expected_revision):
        return self._action("refresh", operation_id, request_id, expected_revision)

    def cancel(self, operation_id, *, request_id, expected_revision, reason):
        return self._action("cancel", operation_id, request_id, expected_revision, reason=reason)

    def provider_jobs(self, operation_id, **query):
        return self.workspace._read("pipelines-provider-jobs", {
            "dossierId": self.dossier_id, "operationId": operation_id, "body": query})

    def reconcile(self, operation_id, *, request_id, expected_revision,
                  expected_plan_sha256, provider_job_id, reason):
        return self._action("reconcile", operation_id, request_id, expected_revision,
                            expectedPlanSha256=expected_plan_sha256, providerJobId=provider_job_id, reason=reason)

    def retain_output(self, operation_id, *, request_id, expected_revision, file_id, node_id=None):
        return self._action("retain", operation_id, request_id, expected_revision,
                            fileId=file_id, nodeId=node_id)

    def output(self, operation_id, output_id):
        return ResearchSelection(self.workspace, self.dossier_id, "pipelines",
                                 {"operationId": operation_id, "outputId": output_id})

    def edition(self, edition_id):
        return ResearchSelection(self.workspace, self.dossier_id, "pipelines", {"editionId": edition_id})

    def download_input(self, operation_id, input_id, file, *, expected_sha256=None):
        return self.workspace._download("pipelines-download-input", {
            "dossierId": self.dossier_id, "operationId": operation_id, "inputId": input_id},
            file=file, expected_sha256=expected_sha256)

    def download_output(self, operation_id, output_id, file, *, expected_sha256=None):
        return self.workspace._download("pipelines-download-output", {
            "dossierId": self.dossier_id, "operationId": operation_id, "outputId": output_id},
            file=file, expected_sha256=expected_sha256)


@dataclass(frozen=True)
class ResearchSelection:
    workspace: object
    dossier_id: str
    family: str
    selection: dict

    def __post_init__(self):
        if self.family not in {"documents", "pipelines"}:
            raise StateError("RESEARCH_DOCUMENT_FAMILY_INVALID")
        object.__setattr__(self, "selection", deepcopy(self.selection))

    def review(self):
        return self.workspace._read(self.family + "-review", {
            "dossierId": self.dossier_id, "selection": self.selection})

    def elements(self, *, expected_edition_sha256, offset=0, limit=25, page="", type="", query=""):
        return self.workspace._read(self.family + "-elements", {"dossierId": self.dossier_id, "body": {
            "selection": self.selection, "expectedEditionSha256": expected_edition_sha256,
            "offset": offset, "limit": limit, "page": page, "type": type, "query": query}})

    def iter_elements(self, *, expected_edition_sha256, offset=0, limit=100, **filters):
        """Yield every original page entry, including its one-based occurrence."""
        while True:
            current = self.elements(expected_edition_sha256=expected_edition_sha256,
                                    offset=offset, limit=limit, **filters)
            for item in current["items"]:
                yield item
            next_offset = current.get("nextOffset")
            if next_offset is None:
                return
            if type(next_offset) is not int or next_offset <= offset:
                raise StateError("RESEARCH_ELEMENT_PAGE_INVALID")
            offset = next_offset

    def receive(self, *, request_id, expected_edition_sha256, question_id, label, expected_revision):
        body = {"selection": self.selection, "expectedEditionSha256": expected_edition_sha256,
                "questionId": question_id, "label": label, "expectedRevision": expected_revision}
        if self.family == "pipelines":
            body["requestId"] = request_id
        # Original Documents receive compares its saved edition before revision
        # CAS; Pipelines carries the original explicit receiving request ID.
        return self.workspace._write(self.family + "-receive",
            {"dossierId": self.dossier_id, "body": body}, request_id=request_id, replay_safe=True)

    def download(self, kind, file, *, expected_edition_sha256, expected_sha256=None, _owned_event=None):
        return self.workspace._download(self.family + "-download", {"dossierId": self.dossier_id, "body": {
            "selection": self.selection, "expectedEditionSha256": expected_edition_sha256, "kind": kind}},
            file=file, expected_sha256=expected_sha256, _owned_event=_owned_event)

    def analysis_source(self, directory, *, expected_edition_sha256, title="Retained document elements",
                        captured_at=None):
        with self.workspace._operation() as event:
            return self._analysis_source_call(directory, expected_edition_sha256=expected_edition_sha256,
                                               title=title, captured_at=captured_at, event=event)

    def _analysis_source_call(self, directory, *, expected_edition_sha256, title, captured_at, event):
        directory = private_directory(Path(directory))
        existing = directory / "source.json"
        if existing.is_file():
            source = ResearchDocumentSource(directory)
            if (source.receipt["identity"]["editionSha256"] != expected_edition_sha256 or
                    source.manifest["title"] != title):
                raise StateError("RESEARCH_ANALYSIS_SOURCE_CHANGED")
            return source
        # Exact downloaded bytes are consumed by the original verifier before
        # the native source manifest is published. The complete source archive
        # then owns these bytes and survives the temporary export's removal.
        with tempfile.TemporaryDirectory(prefix=".research-edition-", dir=directory) as temporary:
            delivery = self.download("edition", Path(temporary) / "edition.json",
                                     expected_edition_sha256=expected_edition_sha256, _owned_event=event)
            return ResearchDocumentSource.create(delivery.expected_destination, directory,
                checkout=self.workspace.runtime.checkout, node=self.workspace.runtime.node,
                environment=self.workspace.runtime.environment,
                expected_sha256=delivery.delivery["sha256"],
                expected_edition_sha256=expected_edition_sha256, title=title, captured_at=captured_at,
                cancel_event=event)


class ResearchDocumentSource:
    """A complete original source-document closure, independent of the provider."""
    def __init__(self, directory):
        from .response_documents import validate_manifest
        self.directory = private_directory(Path(directory), create=False)
        self.manifest_file = self.directory / "source.json"
        raw = read(self.manifest_file, 1024 * 1024)
        self.manifest = validate_manifest(parse(raw))
        self.document_id = digest(raw)
        matches = [item for item in self.manifest["originals"] if item["role"] == "analysis-receipt"]
        if len(matches) != 1:
            raise StateError("RESEARCH_ANALYSIS_RECEIPT_REQUIRED")
        self.receipt = self._delivery(matches[0]).json(limit=32 * 1024 * 1024)
        if self.receipt.get("identity", {}).get("schema") != _SOURCE_RECEIPT:
            raise StateError("RESEARCH_ANALYSIS_RECEIPT_INVALID")

    @classmethod
    def create(cls, edition_file, directory, *, checkout, expected_edition_sha256,
               expected_sha256=None, title="Retained document elements", captured_at=None,
               node="node", environment=None, timeout=360, cancel_event=None):
        selected = private_directory(Path(directory))
        pin = _pin_file(edition_file, 64 * 1024 * 1024)
        if expected_sha256 is not None and expected_sha256 != pin["sha256"]:
            raise StateError("RESEARCH_SELECTED_FILE_CHANGED")
        if captured_at is None and (selected / "source.json").is_file():
            captured_at = parse(read(selected / "source.json", 1024 * 1024))["provenance"]["capturedAt"]
        captured_at = captured_at or datetime.now(timezone.utc).isoformat()
        runtime = Runtime(checkout, node=node, environment=environment, timeout=timeout, output_limit=_LIMIT)
        value = {"editionFile": pin["file"], "expectedSha256": pin["sha256"],
                 "expectedEditionSha256": expected_edition_sha256, "directory": str(selected),
                 "title": title, "capturedAt": captured_at,
                 "runtimeDirectory": str(runtime.checkout / CLI.parent)}
        with tempfile.TemporaryDirectory(prefix=".research-source-call-", dir=selected) as temporary:
            request = Path(temporary) / "request.json"
            dump(request, {"schema": _CALL, "action": "analysis-source", "input": value}, exclusive=True)
            native = runtime.run(["--request", request], target="research", cancel_event=cancel_event)
            result = _value({"returncode": native.returncode, "runtimeError": native.error,
                             "interrupted": native.interrupted, "native": native.output})
        source = cls(selected)
        if result.get("documentId") != source.document_id:
            raise StateError("RESEARCH_ANALYSIS_PUBLICATION_CHANGED")
        return source

    def _delivery(self, record):
        return _file_delivery({"file": str(self.directory / record["path"]),
                               **{key: record[key] for key in ("bytes", "sha256", "contentType")}})

    @property
    def mapping(self):
        return deepcopy(self.receipt["mapping"])

    def verify(self):
        records = {item["path"]: item for item in [self.manifest["document"], *self.manifest["originals"]]}
        for item in records.values():
            with self._delivery(item).open():
                pass
        return {"documentId": self.document_id, "files": len(records),
                "bytes": sum(item["bytes"] for item in records.values()),
                "rowCount": self.receipt["rowCount"], "complete": self.manifest["complete"]}

    def register(self, workspace, name, *, expected_revision=0):
        return workspace.responses.register(name, "document", manifest=self.manifest_file,
                                            format="csv", expected_revision=expected_revision)

    def preview(self, workspace, name, source_revision, *, request_id, mapping=None):
        return workspace.start("response-preview", {"id": request_id, "source": name,
            "source_revision": source_revision, "mapping": self.mapping if mapping is None else deepcopy(mapping)})

    @staticmethod
    def import_preview(workspace, *, request_id, preview_id, preview_sha256, allow_incomplete=False):
        return workspace.start("response-import", {"id": request_id, "preview_id": preview_id,
            "preview_sha256": preview_sha256, "allow_incomplete": allow_incomplete})

    def original(self, role, destination):
        """Reassemble one exact original, including ordered large-file parts."""
        archive = next((item for item in self.receipt["archives"] if item["role"] == role), None)
        if archive is None:
            raise StateError("RESEARCH_ANALYSIS_ORIGINAL_NOT_FOUND")
        destination = Path(destination).expanduser().absolute()
        retained = {item["role"]: item for item in self.manifest["originals"]}
        metadata = {"file": str(destination), "bytes": archive["bytes"],
                    "sha256": archive["sha256"], "contentType": archive["contentType"]}
        if destination.exists():
            delivery = _file_delivery(metadata)
            with delivery.open():
                pass
            return delivery
        fd, temporary = tempfile.mkstemp(prefix=".research-original-", dir=destination.parent)
        count, checksum = 0, hashlib.sha256()
        try:
            with os.fdopen(fd, "wb") as output:
                for part in archive["parts"]:
                    item = retained.get(part["role"])
                    if (item is None or part["offset"] != count or any(part[key] != item[key] for key in
                            ("path", "bytes", "sha256", "contentType"))):
                        raise StateError("RESEARCH_ANALYSIS_ORIGINAL_PART_CHANGED")
                    with self._delivery(item).open() as stream:
                        while block := stream.read(1024 * 1024):
                            count += len(block)
                            if count > archive["bytes"]:
                                raise StateError("RESEARCH_ANALYSIS_ORIGINAL_CHANGED")
                            output.write(block)
                            checksum.update(block)
                if count != archive["bytes"] or checksum.hexdigest() != archive["sha256"]:
                    raise StateError("RESEARCH_ANALYSIS_ORIGINAL_CHANGED")
                output.flush()
                os.fsync(output.fileno())
            os.link(temporary, destination)
            os.unlink(temporary)
            sync_directory(destination.parent)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
        return _file_delivery(metadata)

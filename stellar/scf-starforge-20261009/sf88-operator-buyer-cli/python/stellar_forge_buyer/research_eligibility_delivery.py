"""Complete eligibility reports, original portable history and editable receiving."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile

from .errors import StateError
from .research_workspace import _json, _file_delivery
from .research_citations import _standalone
from .storage import parse, read, write, lock, private_directory, sync_directory

_SCHEMA = "stellar-forge.research-eligibility-delivery.v1"
_HASH = re.compile(r"[a-f0-9]{64}")
_STATE_LIMIT = 32 * 1024 * 1024
_FILE_LIMIT = 256 * 1024 * 1024
_ZIP_LIMIT = 512 * 1024 * 1024
_SECTIONS = ("reviews", "queue", "decisions", "resolutions", "studies",
             "impact", "operations", "occurrences")
_EXPORTS = (("portable-json", None, "dossier.json"),
            ("portable-gzip", None, "dossier.json.gz"),
            ("dossier-html", None, "dossier.html"),
            ("dossier-md", None, "dossier.md"),
            ("eligibility-json", None, "eligibility.json")) + tuple(
                ("eligibility-csv", section, "eligibility-" + section + ".csv")
                for section in _SECTIONS if section != "reviews")


def _need(condition, code):
    if not condition:
        raise StateError(code)


def _object(path):
    value = parse(read(Path(path), _STATE_LIMIT))
    _need(isinstance(value, dict), "ELIGIBILITY_DELIVERY_OBJECT_REQUIRED")
    return value


def _immutable(path, value):
    raw = _json(value) + b"\n"
    _need(len(raw) <= _STATE_LIMIT, "ELIGIBILITY_DELIVERY_STATE_TOO_LARGE")
    if path.exists() or path.is_symlink():
        _need(read(path, _STATE_LIMIT) == raw, "ELIGIBILITY_DELIVERY_RECORD_CHANGED")
    else:
        try:
            write(path, raw, exclusive=True)
        except FileExistsError:
            _need(read(path, _STATE_LIMIT) == raw, "ELIGIBILITY_DELIVERY_RECORD_CHANGED")
    return value


def _pin(file, maximum=_FILE_LIMIT):
    file = Path(file).expanduser().absolute()
    with os.fdopen(os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        before = os.fstat(stream.fileno())
        _need(stat.S_ISREG(before.st_mode) and 0 <= before.st_size <= maximum,
              "ELIGIBILITY_DELIVERY_REGULAR_FILE_REQUIRED")
        count, checksum = 0, hashlib.sha256()
        while block := stream.read(1024 * 1024):
            count += len(block)
            _need(count <= maximum, "ELIGIBILITY_DELIVERY_FILE_TOO_LARGE")
            checksum.update(block)
        after = os.fstat(stream.fileno())
        keys = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        _need(count == before.st_size and all(getattr(before, key) == getattr(after, key) for key in keys),
              "ELIGIBILITY_DELIVERY_FILE_CHANGED")
    return {"file": str(file), "bytes": count, "sha256": checksum.hexdigest()}


def _identity(eligibility, expected=None):
    status = eligibility.workspace.status()
    actual = eligibility.workspace.workspace_id
    _need(isinstance(actual, str) and re.fullmatch(r"research_[a-f0-9]{64}", actual) and
          status.get("workspaceId") == actual and (expected is None or actual == expected),
          "ELIGIBILITY_DELIVERY_WORKSPACE_CHANGED")
    return actual


class EligibilityDelivery:
    """A complete source-bound selection, not another review authority."""
    def __init__(self, directory):
        self.directory = private_directory(Path(directory), create=False)
        self.files = private_directory(self.directory / "files", create=False)
        self.selection_file = self.directory / "selection.json"
        self.selection = _object(self.selection_file)
        _need(self.selection.get("schema") == _SCHEMA, "ELIGIBILITY_DELIVERY_SELECTION_CHANGED")
        self.selection_pin = _pin(self.selection_file, _STATE_LIMIT)

    @classmethod
    def prepare(cls, eligibility, directory, *, review_id, revision=None, work_set_id=None):
        root = private_directory(Path(directory))
        private_directory(root / "files")
        with lock(root):
            path = root / "selection.json"
            if path.exists():
                selected = _object(path)
                _need(selected.get("schema") == _SCHEMA and
                      selected.get("dossierId") == eligibility.dossier_id and
                      selected.get("reviewId") == review_id and
                      selected.get("workSetId") == work_set_id and
                      (revision is None or selected.get("revision") == revision),
                      "ELIGIBILITY_DELIVERY_SELECTION_CHANGED")
                _identity(eligibility, selected.get("workspaceId"))
                return cls(root)
            workspace_id = _identity(eligibility)
            overview = eligibility.read(review_id=review_id, work_set_id=work_set_id, revision=revision)
            revision = overview["dossier"]["revision"]
            _need(overview["reviewId"] == review_id, "ELIGIBILITY_DELIVERY_REVIEW_CHANGED")
            rows = {section: list(eligibility.iter_rows(section=section, review_id=review_id,
                    work_set_id=work_set_id, revision=revision)) for section in _SECTIONS}
            history, offset = [], 0
            while True:
                page = eligibility.workspace.section(eligibility.dossier_id, "revisions",
                    revision=revision, offset=offset, limit=100)
                _need(page.get("revision") == revision, "ELIGIBILITY_HISTORY_REVISION_CHANGED")
                history.extend(page["items"])
                next_offset = page.get("nextOffset")
                if next_offset is None:
                    break
                _need(type(next_offset) is int and next_offset > offset, "ELIGIBILITY_HISTORY_CURSOR_CHANGED")
                offset = next_offset
            selection = {"schema": _SCHEMA, "workspaceId": workspace_id,
                "dossierId": eligibility.dossier_id, "reviewId": review_id,
                "workSetId": work_set_id, "revision": revision,
                "metadata": eligibility.workspace.metadata(eligibility.dossier_id, revision=revision),
                "overview": overview, "history": history, "sections": rows}
            _immutable(path, selection)
        return cls(root)

    def _options(self):
        current = _pin(self.selection_file, _STATE_LIMIT)
        _need(current == self.selection_pin, "ELIGIBILITY_DELIVERY_SELECTION_CHANGED")
        return {"selectionFile": str(self.selection_file), "selectionSha256": current["sha256"]}

    def export(self, eligibility):
        _need(eligibility.dossier_id == self.selection["dossierId"], "ELIGIBILITY_DELIVERY_DOSSIER_CHANGED")
        _identity(eligibility, self.selection["workspaceId"])
        with lock(self.directory):
            records = []
            for kind, section, name in _EXPORTS:
                request = {**self._options(), "kind": kind, "file": str(self.files / name)}
                if section is not None:
                    request["section"] = section
                value = eligibility.workspace._read("eligibility-delivery-export", request)
                with _file_delivery(value).open():
                    pass
                _need(value.get("revision") == self.selection["revision"], "ELIGIBILITY_EXPORT_REVISION_CHANGED")
                records.append({"name": name, "kind": kind, "section": section,
                    "revision": self.selection["revision"],
                    **{key: value[key] for key in ("bytes", "sha256", "contentType")}})
            manifest = {"schema": _SCHEMA, "selectionSha256": self.selection_pin["sha256"],
                "dossierId": self.selection["dossierId"], "reviewId": self.selection["reviewId"],
                "workSetId": self.selection["workSetId"], "revision": self.selection["revision"],
                "files": records}
            _immutable(self.directory / "delivery.json", manifest)
        return manifest

    def verify(self):
        manifest = _object(self.directory / "delivery.json")
        selected = self._options()
        _need(manifest.get("schema") == _SCHEMA and
              manifest.get("selectionSha256") == selected["selectionSha256"] and
              all(manifest.get(key) == self.selection[key] for key in
                  ("dossierId", "reviewId", "workSetId", "revision")),
              "ELIGIBILITY_DELIVERY_CHANGED")
        _need(isinstance(manifest.get("files"), list) and len(manifest["files"]) == len(_EXPORTS) and
              [(row.get("kind"), row.get("section"), row.get("name")) for row in manifest["files"]] == list(_EXPORTS),
              "ELIGIBILITY_DELIVERY_INCOMPLETE")
        for row in manifest["files"]:
            _need(row.get("revision") == self.selection["revision"], "ELIGIBILITY_DELIVERY_REVISION_CHANGED")
            actual = _pin(self.files / row["name"])
            _need(actual["bytes"] == row.get("bytes") and actual["sha256"] == row.get("sha256"),
                  "ELIGIBILITY_DELIVERY_BYTES_CHANGED")
        return manifest

    def receive(self, directory, *, checkout, node="node", environment=None, timeout=900):
        """Receive through both original portable readers into private directories.

        A previous receiving can be opened again after local edits; its immutable
        prefix is verified and its later receiver revisions remain retained.
        """
        manifest = self.verify()
        root = private_directory(Path(directory))
        results = {}
        with lock(root):
            for kind, format, name in (("portable-json", "json", "json-reader"),
                                       ("portable-gzip", "json.gz", "stream-reader")):
                row = next(value for value in manifest["files"] if value["kind"] == kind)
                result = _standalone(checkout, node, "eligibility-receive", {
                    **self._options(), "format": format,
                    "file": str(self.files / row["name"]), "expectedSha256": row["sha256"],
                    "expectedBytes": row["bytes"], "directory": str(root / name)},
                    root, environment=environment, timeout=timeout)
                _need(result.get("dossierId") == self.selection["dossierId"] and
                      result.get("reviewId") == self.selection["reviewId"] and
                      result.get("revision") == self.selection["revision"],
                      "ELIGIBILITY_RECEIVED_SELECTION_CHANGED")
                _need(result.get("operationIds") == [item["id"] for item in self.selection["sections"]["operations"]],
                      "ELIGIBILITY_RECEIVED_OPERATIONS_CHANGED")
                expected_reports = [(kind, section) for kind, section, _ in _EXPORTS
                                    if not kind.startswith("portable-")]
                _need([(row.get("kind"), row.get("section")) for row in result.get("reports", [])] ==
                      expected_reports, "ELIGIBILITY_RECEIVED_REPORTS_INCOMPLETE")
                for report in result["reports"]:
                    original = next(value for value in manifest["files"] if
                        value["kind"] == report["kind"] and value["section"] == report.get("section"))
                    _need(all(report[key] == original[key] for key in ("revision", "bytes", "sha256")),
                          "ELIGIBILITY_RECEIVED_REPORT_CHANGED")
                results[name] = result
            # Paths/currentRevision describe this invocation; the stable native
            # identities remain independently retained inside each receiving root.
            record = {"schema": _SCHEMA, "selectionSha256": self.selection_pin["sha256"],
                "results": {key: {name: value for name, value in item.items()
                           if name not in {"directory", "currentRevision"}} for key, item in results.items()}}
            _immutable(self.directory / "receiving.json", record)
        return results

    def archive(self, file):
        """Package exact reports and full editable source without host credentials."""
        manifest = self.verify()
        members = {"selection.json": self.selection_file,
                   "delivery.json": self.directory / "delivery.json"}
        if (self.directory / "receiving.json").exists():
            members["receiving.json"] = self.directory / "receiving.json"
        for row in manifest["files"]:
            members["files/" + row["name"]] = self.files / row["name"]
        pins = {name: {key: value for key, value in _pin(path).items() if key != "file"}
                for name, path in sorted(members.items())}
        _need(sum(value["bytes"] for value in pins.values()) <= _ZIP_LIMIT,
              "ELIGIBILITY_HANDOVER_TOO_LARGE")
        envelope = {"schema": _SCHEMA, "selectionSha256": self.selection_pin["sha256"], "members": pins}
        file = Path(file).expanduser().absolute()
        private_directory(file.parent)
        descriptor, temporary = tempfile.mkstemp(prefix=".eligibility-handover-", dir=file.parent)
        try:
            with os.fdopen(descriptor, "w+b") as output:
                with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                    names = sorted(members)
                    for name in ["handover-manifest.json", *names]:
                        info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                        info.create_system = 3
                        info.external_attr = (stat.S_IFREG | 0o600) << 16
                        info.compress_type = zipfile.ZIP_DEFLATED
                        if name == "handover-manifest.json":
                            archive.writestr(info, _json(envelope) + b"\n")
                            continue
                        expected, count, checksum = pins[name], 0, hashlib.sha256()
                        with os.fdopen(os.open(members[name], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as source:
                            _need(stat.S_ISREG(os.fstat(source.fileno()).st_mode), "ELIGIBILITY_HANDOVER_FILE_CHANGED")
                            with archive.open(info, "w") as target:
                                while block := source.read(1024 * 1024):
                                    count += len(block)
                                    _need(count <= expected["bytes"], "ELIGIBILITY_HANDOVER_FILE_CHANGED")
                                    checksum.update(block)
                                    target.write(block)
                        _need(count == expected["bytes"] and checksum.hexdigest() == expected["sha256"],
                              "ELIGIBILITY_HANDOVER_FILE_CHANGED")
                output.flush()
                os.fsync(output.fileno())
            actual = _pin(temporary, _ZIP_LIMIT)
            try:
                os.link(temporary, file)
                sync_directory(file.parent)
            except FileExistsError:
                old = _pin(file, _ZIP_LIMIT)
                _need(old["bytes"] == actual["bytes"] and old["sha256"] == actual["sha256"],
                      "ELIGIBILITY_HANDOVER_DESTINATION_EXISTS")
            return {"file": str(file), "bytes": actual["bytes"], "sha256": actual["sha256"],
                    "members": len(pins) + 1, "schema": _SCHEMA}
        finally:
            Path(temporary).unlink(missing_ok=True)

    @classmethod
    def from_archive(cls, file, directory, *, expected_sha256):
        """Receive the exact delivery ZIP with safe names and immutable members."""
        actual = _pin(file, _ZIP_LIMIT)
        _need(isinstance(expected_sha256, str) and _HASH.fullmatch(expected_sha256) and
              actual["sha256"] == expected_sha256, "ELIGIBILITY_HANDOVER_DIGEST_CHANGED")
        root = private_directory(Path(directory))
        with lock(root):
            _immutable(root / "receiving-input.json", {"schema": _SCHEMA,
                       "sha256": actual["sha256"], "bytes": actual["bytes"]})
            with os.fdopen(os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as raw:
                before = os.fstat(raw.fileno())
                _need(stat.S_ISREG(before.st_mode), "ELIGIBILITY_HANDOVER_FILE_CHANGED")
                count, checksum = 0, hashlib.sha256()
                while block := raw.read(1024 * 1024):
                    count += len(block)
                    _need(count <= actual["bytes"], "ELIGIBILITY_HANDOVER_FILE_CHANGED")
                    checksum.update(block)
                _need(count == actual["bytes"] and checksum.hexdigest() == actual["sha256"],
                      "ELIGIBILITY_HANDOVER_FILE_CHANGED")
                raw.seek(0)
                with zipfile.ZipFile(raw) as archive:
                    info = archive.getinfo("handover-manifest.json")
                    _need(info.file_size <= _STATE_LIMIT, "ELIGIBILITY_HANDOVER_MANIFEST_TOO_LARGE")
                    envelope = parse(archive.read(info))
                    pins = envelope.get("members") if isinstance(envelope, dict) else None
                    _need(isinstance(envelope, dict) and envelope.get("schema") == _SCHEMA and isinstance(pins, dict) and
                          1 <= len(pins) <= 10000 and len(archive.infolist()) == len(pins) + 1 and
                          set(archive.namelist()) == set(pins) | {"handover-manifest.json"} and
                          {"selection.json", "delivery.json"} <= set(pins), "ELIGIBILITY_HANDOVER_MEMBERS_CHANGED")
                    total = info.file_size
                    for name, expected in pins.items():
                        _need(isinstance(name, str) and
                              (name in {"selection.json", "delivery.json", "receiving.json"} or
                               re.fullmatch(r"files/[A-Za-z0-9_.-]+", name) and name not in {"files/.", "files/.."}) and
                              isinstance(expected, dict) and type(expected.get("bytes")) is int and
                              0 <= expected["bytes"] <= _FILE_LIMIT and
                              isinstance(expected.get("sha256"), str) and _HASH.fullmatch(expected["sha256"]),
                              "ELIGIBILITY_HANDOVER_MEMBER_INVALID")
                        total += expected["bytes"]
                        _need(total <= _ZIP_LIMIT, "ELIGIBILITY_HANDOVER_TOO_LARGE")
                        member = archive.getinfo(name)
                        _need(member.file_size == expected["bytes"] and not member.is_dir() and
                              stat.S_IFMT(member.external_attr >> 16) in (0, stat.S_IFREG),
                              "ELIGIBILITY_HANDOVER_MEMBER_INVALID")
                        destination = root / name
                        private_directory(destination.parent)
                        descriptor, temporary = tempfile.mkstemp(prefix=".eligibility-receive-", dir=destination.parent)
                        try:
                            count, checksum = 0, hashlib.sha256()
                            with os.fdopen(descriptor, "wb") as output, archive.open(member) as source:
                                while block := source.read(1024 * 1024):
                                    count += len(block)
                                    _need(count <= expected["bytes"], "ELIGIBILITY_HANDOVER_MEMBER_CHANGED")
                                    checksum.update(block)
                                    output.write(block)
                                _need(count == expected["bytes"] and checksum.hexdigest() == expected["sha256"],
                                      "ELIGIBILITY_HANDOVER_MEMBER_CHANGED")
                                output.flush()
                                os.fsync(output.fileno())
                            try:
                                os.link(temporary, destination)
                                sync_directory(destination.parent)
                            except FileExistsError:
                                prior = _pin(destination)
                                _need(prior["bytes"] == expected["bytes"] and prior["sha256"] == expected["sha256"],
                                      "ELIGIBILITY_HANDOVER_DESTINATION_EXISTS")
                        finally:
                            Path(temporary).unlink(missing_ok=True)
                after = os.fstat(raw.fileno())
                _need(all(getattr(before, key) == getattr(after, key) for key in
                          ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")),
                      "ELIGIBILITY_HANDOVER_FILE_CHANGED")
        received = cls(root)
        _need(received.selection_pin["sha256"] == envelope.get("selectionSha256"),
              "ELIGIBILITY_HANDOVER_SELECTION_CHANGED")
        received.verify()
        return received

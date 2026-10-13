"""Reuse exact original HTTP responses across source-acquisition editions.

Only request/response bodies and their original receipts are transferred. Derived
geometry, classifications, family checkpoints, and imported editions are rebuilt.
"""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from urllib.parse import urlencode

from model.common import atomic_json, describe_file, digest, held, identifier, now, read_json

SCHEMA = "upstate.source-acquisition-continuation/v1"
ORIGIN_SCHEMA = "upstate.source-response-reuse/v1"
COUNTERS = ("reused_requests", "reused_bytes", "reused_stored_bytes",
            "successful_responses", "retained_failures")


def _sha(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as incoming:
        for block in iter(lambda: incoming.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def _safe(root, path):
    root, path = Path(root).resolve(), Path(path)
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError("An original source cache leaves its retained acquisition")
    return path


def _verify(path, size, sha256):
    if type(size) is not int or size < 0 or not isinstance(sha256, str):
        raise ValueError("An original response has no complete byte identity")
    if not path.is_file() or path.stat().st_size != size or _sha(path) != sha256:
        raise ValueError("An original source response differs from its retained receipt")


def _gzip_identity(path, size, sha256):
    if type(size) is not int or size < 0 or not isinstance(sha256, str):
        raise ValueError("An original response has no decoded byte identity")
    actual = 0
    value = hashlib.sha256()
    with gzip.open(path, "rb") as incoming:
        while True:
            block = incoming.read(min(1024 * 1024, size - actual + 1))
            if not block:
                break
            actual += len(block)
            if actual > size:
                raise ValueError("An original response exceeds its retained byte identity")
            value.update(block)
    if actual != size or value.hexdigest() != sha256:
        raise ValueError("An original response differs after decompressing its retained body")


def _selection(root, key):
    key = identifier(key)
    folder = Path(root) / key
    selected = read_json(folder / "selection.json")
    if digest(selected) != key:
        raise ValueError("The original source acquisition identity differs")
    return folder, selected


def _lineage(root, selection):
    """Read only immutable selections before obtaining their sorted lock set."""
    rows, seen = [], set()
    key = selection.get("continued_from")
    child = selection
    while key:
        key = identifier(key)
        if key in seen:
            raise ValueError("A source acquisition continuation contains a cycle")
        seen.add(key)
        folder, parent = _selection(root, key)
        for field in ("schema", "version", "request", "domain", "query_domain_wkt",
                      "query_domain_sha256", "reused_sources"):
            if child.get(field) != parent.get(field):
                raise ValueError("A continued acquisition changed its original " + field)
        rows.append((folder, parent))
        child, key = parent, parent.get("continued_from")
    return rows


def _provenance(directory, selection, rows):
    if not rows:
        return None
    parent_folder, parent = rows[0]
    path = directory / "continuation.json"
    expected = {
        "schema": SCHEMA, "operation_id": directory.name,
        "previous_operation_id": parent_folder.name,
        "previous_implementation": parent["implementation"],
        "current_implementation": selection["implementation"],
        "donor_directory": parent_folder.relative_to(directory.parent.parent).as_posix(),
        "request_sha256": digest(selection["request"]),
        "query_domain_sha256": selection["query_domain_sha256"],
        "previous_selection": describe_file(directory.parent.parent, parent_folder / "selection.json"),
        "previous_selection_body": parent,
    }
    if path.exists():
        saved = read_json(path)
        if any(saved.get(key) != value for key, value in expected.items()):
            raise ValueError("The retained source continuation provenance differs")
        metadata = {key: value for key, value in saved.items() if key != "previous_selection_body"}
        atomic_json(directory / "continuation-metadata.json", metadata, immutable=True)
        return saved
    saved = {**expected, "created_at": now()}
    atomic_json(path, saved, immutable=True)
    metadata = {key: value for key, value in saved.items() if key != "previous_selection_body"}
    atomic_json(directory / "continuation-metadata.json", metadata, immutable=True)
    return saved


@contextmanager
def locked(workspace, directory, selection):
    """One lock discipline for creation, resumption, and all original donors."""
    directory = Path(directory)
    rows = _lineage(directory.parent, selection)
    folders = {directory, *(folder for folder, _ in rows)}
    with ExitStack() as stack:
        for folder in sorted(folders):
            stack.enter_context(held(folder / ".capture.lock", blocking=False))
        # Original selections are immutable; validate them again after obtaining
        # every donor lock before transferring any captured body.
        refreshed = _lineage(directory.parent, selection)
        if refreshed != rows:
            raise ValueError("The original acquisition lineage changed")
        provenance = _provenance(directory, selection, rows)
        yield ResponseReuse(workspace, directory, rows, provenance) if rows else None


def details(directory, *, state=None, states=None):
    """Read compact polling metadata without loading a query WKT or provenance body."""
    directory = Path(directory)
    metadata_path = directory / "continuation-metadata.json"
    if metadata_path.is_file():
        result = read_json(metadata_path)
    else:
        # Earlier editions embedded their complete predecessor selection in
        # continuation.json. Their small state retains enough lineage for the
        # operator, while that full document remains the export authority.
        if state is None:
            state_path = directory / "state.json"
            state = read_json(state_path) if state_path.is_file() else {}
        selection = state.get("selection", {})
        previous = selection.get("continued_from")
        if not previous:
            return None
        previous = identifier(previous)
        previous_state = (states or {}).get(previous)
        if previous_state is None:
            previous_path = directory.parent / previous / "state.json"
            previous_state = read_json(previous_path) if previous_path.is_file() else {}
        result = {
            "schema": SCHEMA, "operation_id": directory.name,
            "previous_operation_id": previous,
            "previous_implementation": previous_state.get("selection", {}).get("implementation"),
            "current_implementation": selection.get("implementation"),
            "donor_directory": (directory.parent / previous).relative_to(directory.parent.parent).as_posix(),
            "request_sha256": digest(selection["request"]),
            "query_domain_sha256": selection.get("query_domain_sha256"),
        }
    if result.get("schema") != SCHEMA or result.get("operation_id") != directory.name:
        raise ValueError("The compact source continuation selects another acquisition")
    summary_path = directory / "continuation-reuse.json"
    summary = read_json(summary_path) if summary_path.is_file() else {}
    return {**result, **{key: summary.get(key, 0) for key in COUNTERS},
            "families": summary.get("families", {})}


def children(root, *, states=None):
    """Derive successor links from one shared set of small acquisition states."""
    result = {}
    root = Path(root)
    if not root.exists():
        return result
    if states is None:
        states = {
            path.parent.name: read_json(path) for path in sorted(root.glob("*/state.json"))
            if re.fullmatch(r"[0-9a-f]{64}", path.parent.name)
        }
    for key, state in states.items():
        previous = state.get("selection", {}).get("continued_from")
        if previous:
            result.setdefault(identifier(previous), []).append({
                "id": key, "state": state.get("state", "prepared"),
                "title": state.get("title"), "updated_at": state.get("updated_at"),
            })
    # A process can stop after publishing provenance and before its first state.
    # New editions retain a small metadata record for that prepared successor.
    for path in sorted(root.glob("*/continuation-metadata.json")):
        key = path.parent.name
        if key in states or not re.fullmatch(r"[0-9a-f]{64}", key):
            continue
        row = read_json(path)
        if row.get("schema") != SCHEMA or row.get("operation_id") != key:
            raise ValueError("The compact source continuation selects another acquisition")
        result.setdefault(identifier(row["previous_operation_id"]), []).append({
            "id": key, "state": "prepared", "title": None, "updated_at": row.get("created_at"),
        })
    for rows in result.values():
        rows.sort(key=lambda row: row["id"])
    return result


class ResponseReuse:
    def __init__(self, workspace, directory, donors, provenance):
        self.workspace, self.directory = workspace, Path(directory)
        self.donors, self.provenance = donors, provenance
        self.indexes = {}
        self.ledger = self.directory / "continuation-reuse"
        self.ledger.mkdir(parents=True, exist_ok=True)
        self.records = {}
        for path in self.ledger.glob("*.json"):
            row = read_json(path)
            if row.get("schema") != ORIGIN_SCHEMA or row.get("operation_id") != self.directory.name:
                raise ValueError("An original-response reuse record selects another acquisition")
            self.records[path.stem] = row
        self.totals = {key: 0 for key in COUNTERS}
        self.family_totals = {}
        for row in self.records.values():
            self._add_counts(row)
        self._summary()

    def _add_counts(self, row):
        family = self.family_totals.setdefault(row["family"], {key: 0 for key in COUNTERS})
        for key in COUNTERS:
            self.totals[key] += row[key]
            family[key] += row[key]

    def _summary(self):
        result = {**self.totals, "schema": "upstate.source-response-reuse-summary/v1",
                  "operation_id": self.directory.name, "families": self.family_totals}
        atomic_json(self.directory / "continuation-reuse.json", result)

    def snapshot(self):
        value = {"schema": "upstate.source-response-reuse-ledger/v1",
                 "operation_id": self.directory.name,
                 "previous_operation_id": self.provenance["previous_operation_id"],
                 "requests": [self.records[key] for key in sorted(self.records)],
                 "counts": {**self.totals, "families": self.family_totals}}
        path = self.directory / ("continuation-ledger-" + digest(value) + ".json")
        atomic_json(path, value, immutable=True)
        return [self.directory / "continuation.json", path]

    def unpublished_companions(self, completed):
        """Keep failed-family response provenance in a partial source export."""
        paths = set()
        for row in self.records.values():
            if row["family"] in completed:
                continue
            folder = _safe(self.directory, self.directory / row["target_directory"])
            paths.add(folder / "continuation-origin.json")
            for descriptor in row["files"]:
                path = _safe(folder, folder / descriptor["path"])
                if path.is_file():
                    paths.add(path)
                elif path.name.endswith(".partial") and path.with_suffix("").is_file():
                    # The native SDA reader atomically finalizes a received body.
                    paths.add(path.with_suffix(""))
        return sorted(paths)

    def _index(self, family):
        if family in self.indexes:
            return self.indexes[family]
        index = {}
        for rank, (donor, _) in enumerate(self.donors):
            if family == "soils":
                paths = sorted((donor / "soils" / "sda" / "original").glob("**/request.json"))
                for path in paths:
                    if any(part.startswith(".") for part in path.relative_to(donor).parts):
                        continue
                    _safe(donor, path)
                    request = read_json(path)
                    receipts = sorted(path.parent.glob("[0-9][0-9][0-9][0-9].capture.json"))
                    if receipts:
                        receipt_path = _safe(donor, receipts[-1])
                        receipt = read_json(receipt_path)
                        order = (receipt.get("observed_at") or receipt.get("requested_at") or "", -rank)
                        token = digest(request)
                        if token not in index or order > index[token][0]:
                            index[token] = (order, donor, path.parent, receipt_path, request, receipt)
            else:
                root = donor / "floodplains" / "original-nfhl" / "responses"
                # Each request's final attempt is authoritative, including a
                # retained failure with a future Retry-After deadline.
                groups = {}
                for path in sorted(root.glob("*/receipt.json")):
                    if path.parent.name.startswith("."):
                        continue
                    _safe(donor, path)
                    base = re.sub(r"\.attempt-[0-9]+$", "", path.parent.name)
                    groups.setdefault(base, []).append(path)
                for paths in groups.values():
                    receipt_path = paths[-1]
                    receipt = read_json(receipt_path)
                    request = receipt["request"]
                    order = (receipt.get("captured_at") or receipt.get("requested_at") or "", -rank)
                    token = digest(request)
                    if token not in index or order > index[token][0]:
                        index[token] = (order, donor, receipt_path.parent, receipt_path, request, receipt)
        self.indexes[family] = index
        return index

    def _record(self, folder):
        marker = folder / "continuation-origin.json"
        if not marker.is_file():
            return
        row = read_json(marker)
        token = digest(row["target_directory"])
        if token in self.records:
            return
        if row.get("schema") != ORIGIN_SCHEMA or row.get("operation_id") != self.directory.name:
            raise ValueError("A copied response marker selects another acquisition")
        for descriptor in row["files"]:
            path = _safe(folder, folder / descriptor["path"])
            _verify(path, descriptor["bytes"], descriptor["sha256"])
        atomic_json(self.ledger / (token + ".json"), row, immutable=True)
        self.records[token] = row
        self._add_counts(row)
        self._summary()

    def _transfer(self, family, target, entry, request):
        _, donor, original, receipt_path, actual, receipt = entry
        if actual != request:
            raise ValueError("The requested original response identity differs")
        target = _safe(self.directory, target)
        if target.exists():
            self._record(target)
            if any(target.iterdir()):
                return
            target.rmdir()
        files = [receipt_path]
        success = False
        wire_bytes = 0
        if family == "soils":
            files.append(original / "request.json")
            if any(receipt.get(key) != value for key, value in request.items() if key != "schema"):
                raise ValueError("The original SDA receipt selects another request")
            attempt = receipt.get("attempt")
            if type(attempt) is not int or attempt < 1:
                raise ValueError("The original SDA receipt has no attempt identity")
            prefix = str(attempt).zfill(4)
            if receipt_path.name != prefix + ".capture.json":
                raise ValueError("The SDA receipt filename and attempt differ")
            if receipt.get("stored_file") != prefix + ".body.gz" or receipt.get("receipt_file") != receipt_path.name:
                raise ValueError("The original SDA body/receipt filenames differ")
            body = original / receipt["stored_file"]
            partial = original / (receipt["stored_file"] + ".partial")
            if receipt.get("state") in ("received", "complete"):
                body = body if body.exists() else partial
                _safe(donor, body)
                _verify(body, receipt.get("stored_bytes"), receipt.get("stored_sha256"))
                _gzip_identity(body, receipt.get("bytes"), receipt.get("sha256"))
                files.append(body)
                wire_bytes = receipt["bytes"]
                success = receipt.get("status") == 200
            elif partial.exists() and receipt.get("partial_stored_sha256"):
                _safe(donor, partial)
                _verify(partial, receipt.get("partial_stored_bytes"),
                        receipt.get("partial_stored_sha256"))
                files.append(partial)
                wire_bytes = receipt.get("received_bytes", 0)
        else:
            body = _safe(donor, original / "body.json.gz")
            _verify(body, receipt.get("stored_bytes"), receipt.get("stored_sha256"))
            _gzip_identity(body, receipt.get("bytes"), receipt.get("sha256"))
            files.append(body)
            wire_bytes = receipt.get("wire_bytes", receipt["bytes"])
            wire_hash = receipt.get("wire_sha256", receipt["sha256"])
            wire_name = receipt.get("wire_file") or "wire.bin"
            if wire_name != Path(wire_name).name:
                raise ValueError("The original response has an invalid wire filename")
            wire = _safe(donor, original / wire_name)
            if wire.exists() or wire_hash != receipt["sha256"] or wire_bytes != receipt["bytes"]:
                _verify(wire, wire_bytes, wire_hash)
                files.append(wire)
            form = original / "request.form"
            if request.get("method") == "POST":
                _safe(donor, form)
                if not form.is_file() or _sha(form) != request.get("body_sha256"):
                    raise ValueError("The original FEMA request body differs")
                files.append(form)
            metadata = original / "source-receipt.json"
            if metadata.is_file():
                files.append(metadata)
            try:
                with gzip.open(body, "rt", encoding="utf-8") as incoming:
                    decoded = json.load(incoming)
            except (ValueError, UnicodeDecodeError):
                decoded = None
            success = receipt.get("status") == 200 and isinstance(decoded, dict) and "error" not in decoded
        target.parent.mkdir(parents=True, exist_ok=True)
        staged = Path(tempfile.mkdtemp(prefix=".response-reuse-", dir=self.directory))
        try:
            descriptors = []
            for source in files:
                _safe(donor, source)
                destination = staged / source.name
                shutil.copyfile(source, destination)
                descriptor = describe_file(original, source)
                # Every selected response file lives directly in one request
                # folder; no derived output or mutable shared inode is copied.
                if descriptor["path"] != source.name:
                    raise ValueError("An original response file leaves its request folder")
                _verify(destination, descriptor["bytes"], descriptor["sha256"])
                descriptors.append(descriptor)
            # The existing SDA reader may finalize the working receipt after
            # transfer. Retain the exact donor receipt as a separate companion.
            original_receipt = staged / "continuation-original-receipt.json"
            shutil.copyfile(receipt_path, original_receipt)
            original_receipt_descriptor = describe_file(staged, original_receipt)
            if original_receipt_descriptor["sha256"] != _sha(receipt_path):
                raise ValueError("The original receipt changed during transfer")
            descriptors.append(original_receipt_descriptor)
            row = {
                "schema": ORIGIN_SCHEMA, "operation_id": self.directory.name,
                "family": family, "previous_operation_id": donor.name,
                "donor_directory": original.relative_to(self.workspace.root).as_posix(),
                "target_directory": target.relative_to(self.directory).as_posix(),
                "request": request, "receipt": receipt_path.name,
                "original_receipt_file": "continuation-original-receipt.json",
                "original_status": receipt.get("status"), "original_state": receipt.get("state"),
                "copied_at": now(), "files": descriptors,
                "reused_requests": 1, "reused_bytes": wire_bytes,
                "reused_stored_bytes": sum(item["bytes"] for item in descriptors),
                "successful_responses": int(success), "retained_failures": int(not success),
            }
            atomic_json(staged / "continuation-origin.json", row, immutable=True)
            os.rename(staged, target)
            self._record(target)
        finally:
            if staged.exists():
                shutil.rmtree(staged)

    def seed_sda(self, root, name, fields, maximum_bytes):
        fields = {key: str(value) for key, value in fields.items()}
        payload = urlencode(sorted(fields.items())).encode("utf-8")
        request = {
            "schema": "upstate.sda-request/v1", "url": "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest",
            "method": "POST", "content_type": "application/x-www-form-urlencoded",
            "fields": fields, "request_sha256": hashlib.sha256(payload).hexdigest(),
            "maximum_response_bytes": maximum_bytes,
        }
        target = Path(root) / "original" / name
        if target.exists():
            self._record(target)
            if any(target.iterdir()):
                return
        entry = self._index("soils").get(digest(request))
        if entry:
            self._transfer("soils", target, entry, request)

    def sda(self, root):
        from source_tools.soil_sources import Sda
        reuse = self

        class ContinuedSda(Sda):
            def post(self, name, fields, *, maximum_bytes=32 * 1024 * 1024):
                reuse.seed_sda(self.root, name, fields, maximum_bytes)
                return super().post(name, fields, maximum_bytes=maximum_bytes)

        return ContinuedSda(root, resume=True)

    def seed_overlay(self, root, name, url, parameters=None):
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+", name):
            raise ValueError("Choose an original response name")
        root = Path(root)
        # A target's own later attempts remain authoritative on resume.
        if (root / name).exists() or any(root.glob(name + ".attempt-*")):
            if (root / name).exists():
                self._record(root / name)
            return
        data = None if parameters is None else urlencode(parameters).encode("utf-8")
        request = {"url": url, "method": "GET" if data is None else "POST",
                   "body_sha256": hashlib.sha256(data).hexdigest() if data is not None else None,
                   "parameters": parameters}
        entry = self._index("floodplains").get(digest(request))
        if entry:
            self._transfer("floodplains", root / name, entry, request)

    def overlay(self, original_class, root, url, retry_failed):
        reuse = self

        class ContinuedResponses(original_class):
            def response(self, name, url, parameters=None):
                reuse.seed_overlay(self.root, name, url, parameters)
                return super().response(name, url, parameters)

        client = ContinuedResponses(root, retry_failed=retry_failed)
        # Preserve already captured original metadata before the collector's
        # optional external metadata seed is considered.
        self.seed_overlay(root, "metadata", url + "?f=pjson")
        return client

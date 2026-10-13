"""Python customer resource review through the maintained native SF88 engine.

No SQLite schema, comparison algorithm, decision journal, or reconciliation rule
is implemented here. Every application operation delegates to its original owner.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
from typing import Any, Iterator, Literal

from ._review_transport import ReviewError, ReviewTransport, absolute
from ._review_transfer import ReviewFile, ReviewTransferError, TransferProgress, copy_native_file
from .errors import StateError
from .storage import private_directory, read, write

ReviewStatus = Literal["ACCEPT", "REJECT", "FOLLOW_UP"]
ReviewChoice = Literal["KEEP_LOCAL", "TAKE_INCOMING", "CUSTOM"]
ReportFormat = Literal["json", "csv", "html"]
ComparisonFormat = Literal["auto", "json", "csv", "text", "bytes"]


def _present(**values):
    return {key: value for key, value in values.items() if value is not None}


def _iterate(fetch, *, page_size=100, **options) -> Iterator[dict[str, Any]]:
    """Traverse the actual native cursor. Concurrent edits require a fresh scan."""
    if type(page_size) is not int or not 1 <= page_size <= 200:
        raise StateError("REVIEW_PAGE_SIZE_INVALID")
    offset, expected_total, generation = 0, None, None
    while True:
        page = fetch(offset=offset, limit=page_size, **options)
        total, items = page.get("total"), page.get("items")
        if type(total) is not int or total < 0 or not isinstance(items, list) or page.get("offset", offset) != offset:
            raise StateError("REVIEW_PAGE_INVALID")
        current = (page.get("scan") or {}).get("generation") or page.get("planSha256")
        if expected_total is not None and (total != expected_total or current != generation):
            raise StateError("REVIEW_PAGE_CHANGED")
        expected_total, generation = total, current
        yield from items
        offset += len(items)
        if offset >= total:
            return
        if not items:
            raise StateError("REVIEW_PAGE_INCOMPLETE")


class ResourceLibrary:
    """Owns a native process, not a second resource store. Always close or use with."""
    def __init__(self, *, checkout, state, node="node", kind=None, source=None,
                 roots=None, max_file_bytes=None, index_bytes=None,
                 timeout=360.0, environment=None):
        self.state = Path(absolute(state))
        self.checkout = Path(absolute(checkout))
        configuration = _present(state=str(self.state), kind=kind,
            source=None if source is None else absolute(source),
            roots=None if roots is None else [absolute(path) for path in roots],
            maxFileBytes=max_file_bytes, indexBytes=index_bytes)
        self._transport = ReviewTransport(checkout=str(self.checkout), node=node,
            configuration=configuration, timeout=timeout, environment=environment)
        self.runtime = self._transport.opened

    @classmethod
    def from_buyer(cls, buyer, *, state, **options):
        """Reuse the original Buyer's chosen checkout/runtime; no purchase is started."""
        runtime = getattr(buyer, "runtime", None)
        if runtime is None or not hasattr(runtime, "checkout"):
            raise StateError("ORIGINAL_BUYER_RUNTIME_REQUIRED")
        return cls(checkout=runtime.checkout, state=state, node=runtime.node,
                   environment=runtime.environment, timeout=runtime.timeout, **options)

    @classmethod
    def receiver(cls, *, checkout, state, **options):
        """Create/open an original empty snapshot library for portable review intake."""
        state = Path(absolute(state))
        if state.resolve() != state:
            raise StateError("REVIEW_CANONICAL_STATE_REQUIRED")
        state = private_directory(state)
        if (state / "library.sqlite").exists():
            return cls(checkout=checkout, state=state, **options)
        source, files = state / "receiver-source.json", state / "receiver-files"
        private_directory(files)
        if source.exists() or source.is_symlink():
            if read(source, 16) != b"[]\n":
                raise StateError("REVIEW_RECEIVER_SOURCE_CONFLICT")
        else:
            write(source, b"[]\n", exclusive=True)
        return cls(checkout=checkout, state=state, kind="snapshot", source=source,
                   roots=[files], **options)

    @property
    def capabilities(self) -> dict[str, bool]:
        return dict(self.runtime["features"])

    @property
    def pid(self) -> int:
        return self._transport.pid

    def _call(self, action, parameters=None, **options):
        return self._transport.call(action, parameters, **options)

    def invoke(self, action: str, parameters=None, *, timeout=None, cancel_event=None):
        """The declared native actions only; useful for a newer compatible field."""
        if action not in self.runtime["actions"] or action == "close":
            raise StateError("REVIEW_ACTION_INVALID")
        return self._call(action, parameters, timeout=timeout, cancel_event=cancel_event)

    def status(self):
        return self._call("library.status")

    def scan(self, *, cancel_event=None, timeout=None):
        return self._call("library.scan", cancel_event=cancel_event, timeout=timeout)

    def search(self, *, q="", offset=0, limit=50, status="", starred=False):
        return self._call("library.search", dict(q=q, offset=offset, limit=limit, status=status, starred=starred))

    def iter_resources(self, *, page_size=100, **filters):
        return _iterate(self.search, page_size=page_size, **filters)

    def resource(self, resource_id: str):
        return self._call("library.resource", {"id": resource_id})

    def preview(self, resource_id: str, *, cancel_event=None):
        return self._call("library.preview", {"id": resource_id}, cancel_event=cancel_event)

    def select_resource(self, resource_id: str | None):
        return self._call("library.select", {"id": resource_id})

    def annotate(self, resource_id: str, *, expected_revision: int, operation_id: str,
                 note=None, tags=None, starred=None):
        return self._call("annotation.save", {"id": resource_id, "input": _present(
            expectedRevision=expected_revision, operationId=operation_id,
            note=note, tags=tags, starred=starred)})

    def annotation_history(self, resource_id: str):
        return self._call("annotation.history", {"id": resource_id})

    def collections(self, *, offset=0, limit=50):
        return self._call("collections.list", dict(offset=offset, limit=limit))

    def collection(self, collection_id: str, *, revision=None):
        return self._call("collections.show", _present(id=collection_id, revision=revision))

    def collection_history(self, collection_id: str, *, offset=0, limit=50):
        return self._call("collections.history", {"id": collection_id, "options": dict(offset=offset, limit=limit)})

    def save_collection(self, *, collection_id: str, name: str, members: list[dict],
                        expected_revision: int, operation_id: str, note=None):
        return self._call("collections.save", _present(id=collection_id, name=name,
            members=members, expectedRevision=expected_revision, operationId=operation_id, note=note))

    def comparisons(self, *, offset=0, limit=50):
        return self._call("comparisons.list", dict(offset=offset, limit=limit))

    def iter_comparisons(self, *, page_size=100):
        return _iterate(self.comparisons, page_size=page_size)

    def comparison(self, comparison_id: str) -> Comparison:
        record = self._call("comparisons.inspect", {"id": comparison_id})
        return Comparison(record["id"], self, record)

    def select_comparison(self, comparison_id: str | None):
        return self._call("comparisons.select", {"id": comparison_id})

    def compare(self, before_id: str, after_id: str, *, operation_id: str,
                format: ComparisonFormat = "auto", key_columns=None, max_input_bytes=None,
                max_nodes=None, max_changes=None, wait=True, cancel_event=None, timeout=None) -> Comparison:
        parameters = _present(beforeId=before_id, afterId=after_id, operationId=operation_id,
            format=format, keyColumns=key_columns, maxInputBytes=max_input_bytes,
            maxNodes=max_nodes, maxChanges=max_changes)
        record = self._call("comparisons.run" if wait else "comparisons.begin", parameters,
                            cancel_event=cancel_event, timeout=timeout)
        return Comparison(record["id"], self, record)

    def import_review(self, path, *, operation_id: str, expected_sha256=None) -> Comparison:
        record = self._call("comparisons.import", _present(path=absolute(path),
            operationId=operation_id, sha256=expected_sha256))
        return Comparison(record["id"], self, record)

    def verify_review(self, path, *, expected_sha256=None):
        return self._call("handover.verify", _present(path=absolute(path), sha256=expected_sha256))

    def stage_return(self, path, *, operation_id: str, expected_sha256=None) -> ReviewReturn:
        record = self._call("returns.stage", _present(path=absolute(path),
            operationId=operation_id, sha256=expected_sha256))
        return ReviewReturn(record["id"], self, record)

    def review_return(self, return_id: str) -> ReviewReturn:
        record = self._call("returns.inspect", {"id": return_id})
        return ReviewReturn(record["id"], self, record)

    def returns(self, *, comparison_id=None, offset=0, limit=50):
        return self._call("returns.list", _present(comparisonId=comparison_id, offset=offset, limit=limit))

    def iter_returns(self, *, comparison_id=None, page_size=100):
        return _iterate(self.returns, comparison_id=comparison_id, page_size=page_size)

    def download_resource(self, resource_id: str, destination, **options) -> ReviewFile:
        return copy_native_file(self, {"kind": "resource", "id": resource_id}, destination, **options)

    def export_resource_review(self, destination, **options) -> ReviewFile:
        return copy_native_file(self, {"kind": "library-review"}, destination, **options)

    def close(self):
        self._transport.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


@dataclass
class Comparison:
    id: str
    _library: ResourceLibrary = field(repr=False)
    observed: dict[str, Any] = field(repr=False)

    def inspect(self):
        self.observed = self._library._call("comparisons.inspect", {"id": self.id})
        return self.observed

    def wait(self, *, timeout=None, cancel_event=None):
        self.observed = self._library._call("comparisons.wait", {"id": self.id},
            timeout=timeout, cancel_event=cancel_event)
        return self.observed

    def cancel(self):
        self.observed = self._library._call("comparisons.cancel", {"id": self.id})
        return self.observed

    def resume(self, *, operation_id: str, wait=True, timeout=None, cancel_event=None):
        self.observed = self._library._call("comparisons.resume", {"id": self.id,
            "options": {"operationId": operation_id}, "wait": wait}, timeout=timeout, cancel_event=cancel_event)
        return self.observed

    def changes(self, *, offset=0, limit=50, type="", q="", review=""):
        return self._library._call("comparisons.changes", {"id": self.id,
            "options": dict(offset=offset, limit=limit, type=type, q=q, review=review)})

    def iter_changes(self, *, page_size=100, **filters):
        return _iterate(self.changes, page_size=page_size, **filters)

    def decide(self, *, target="*", expected_revision: int, operation_id: str,
               status: ReviewStatus, actor: str, note=""):
        return self._library._call("comparisons.decide", {"id": self.id, "input": dict(
            target=target, expectedRevision=expected_revision, operationId=operation_id,
            status=status, actor=actor, note=note)})

    def history(self, *, target=None):
        return self._library._call("comparisons.history", {"id": self.id, "options": _present(target=target)})

    def export(self, destination, *, format: ReportFormat = "json", **options) -> ReviewFile:
        return copy_native_file(self._library, {"kind": "comparison", "id": self.id,
            "format": format}, destination, **options)

    def returns(self, *, offset=0, limit=50):
        return self._library.returns(comparison_id=self.id, offset=offset, limit=limit)


@dataclass
class ReviewReturn:
    id: str
    _library: ResourceLibrary = field(repr=False)
    observed: dict[str, Any] = field(repr=False)

    def inspect(self):
        self.observed = self._library._call("returns.inspect", {"id": self.id})
        return self.observed

    def targets(self, *, offset=0, limit=50, state=""):
        return self._library._call("returns.targets", {"id": self.id,
            "options": dict(offset=offset, limit=limit, state=state)})

    def iter_targets(self, *, page_size=100, state=""):
        return _iterate(self.targets, page_size=page_size, state=state)

    def choose(self, *, target: str, plan_sha256: str, expected_revision: int,
               operation_id: str, choice: ReviewChoice, actor: str, note: str,
               status: ReviewStatus | None = None):
        return self._library._call("returns.choose", {"id": self.id, "input": _present(
            target=target, planSha256=plan_sha256, expectedRevision=expected_revision,
            operationId=operation_id, choice=choice, actor=actor, note=note, status=status)})

    def apply(self, *, plan_sha256: str, operation_id: str):
        return self._library._call("returns.apply", {"id": self.id,
            "input": dict(planSha256=plan_sha256, operationId=operation_id)})

    def decision_history(self, *, target: str, side="incoming", offset=0, limit=50):
        return self._library._call("returns.decisions", {"id": self.id,
            "options": dict(target=target, side=side, offset=offset, limit=limit)})

    def choice_history(self, *, target: str, offset=0, limit=50):
        return self._library._call("returns.choices", {"id": self.id,
            "options": dict(target=target, offset=offset, limit=limit)})

    def export_original(self, destination, *, format: ReportFormat = "json", **options) -> ReviewFile:
        return copy_native_file(self._library, {"kind": "return", "id": self.id,
            "format": format}, destination, **options)


__all__ = ["ResourceLibrary", "Comparison", "ReviewReturn", "ReviewFile", "ReviewError",
           "ReviewTransferError", "TransferProgress", "ReviewStatus", "ReviewChoice", "ReportFormat"]

"""Local request authoring through the original SF88 multipart implementation."""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import tempfile

from .errors import StateError
from .storage import digest, dump, read

# This is the original SF31 replayable-body ceiling. The selected native runtime
# validates the body, merchant schema, media type and its exact byte pins.
MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True)
class UploadFile:
    field: str
    path: str | os.PathLike
    filename: str | None = None
    content_type: str | None = None

    def selection(self):
        value = {"field": self.field,
                 "path": os.path.abspath(os.path.expanduser(os.fspath(self.path)))}
        if self.filename is not None:
            value["filename"] = self.filename
        if self.content_type is not None:
            value["contentType"] = self.content_type
        return value


@dataclass(frozen=True)
class MultipartRequest:
    """Fields and files are encoded by SF30 once, before native review."""
    fields: dict | None = None
    files: tuple[UploadFile, ...] = ()

    def selection(self):
        return {"fields": dict(self.fields or {}), "files": [file.selection() for file in self.files]}


def multipart_body(operation, value, headers=None):
    """Return native encoded bytes and headers. Caller holds the operation lock."""
    selection = value.selection() if isinstance(value, MultipartRequest) else value
    if not isinstance(selection, dict):
        raise StateError("MULTIPART_SELECTION_REQUIRED")
    with tempfile.TemporaryDirectory(prefix=".multipart-", dir=operation.directory) as temporary:
        directory = Path(temporary)
        request = directory / "selection.json"
        destination = directory / "request.body"
        dump(request, selection, exclusive=True)
        native = operation.buyer.runtime.checked(["multipart", "--input", request,
            "--out", destination], mode="ORIGINAL_PYTHON_MULTIPART_PREPARED", target="consumer")
        body = read(destination, MAX_REQUEST_BODY_BYTES)
        if (native.get("bodyFile") != str(destination)
                or native.get("bodyBytes") != len(body)
                or native.get("bodySha256") != digest(body)
                or not isinstance(native.get("headers"), dict)):
            raise StateError("ORIGINAL_MULTIPART_RESULT_INVALID")
        # The original encoder owns the boundary. Other request headers survive.
        selected = {key: value for key, value in dict(headers or {}).items()
                    if key.lower() != "content-type"}
        selected.update(native["headers"])
        return body, selected

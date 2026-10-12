"""Original authenticated operator upload, with a retained document description."""
import os
from pathlib import Path
import shutil
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit

from model import fail, member, parse
from workspace import Workspace
from .service import PropertyResearch


def upload_document(handler):
    if handler.headers.get_content_type() != "application/octet-stream":
        fail("PROPERTY_DOCUMENT_UPLOAD_REQUIRED")
    parameters = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
    if set(parameters) != {"name"} or len(parameters["name"]) != 1:
        fail("PROPERTY_DOCUMENT_FILENAME_REQUIRED")
    name = member(parameters["name"][0])
    if "/" in name or len(name) > 200:
        fail("PROPERTY_DOCUMENT_FILENAME_REQUIRED")
    descriptions = handler.headers.get_all("X-Property-Metadata") or []
    if len(descriptions) != 1 or len(descriptions[0]) > 48000:
        fail("PROPERTY_DOCUMENT_METADATA_REQUIRED")
    metadata = parse(unquote(descriptions[0], encoding="utf-8", errors="strict").encode())
    size = handler.body_length(512 * 1024 * 1024)
    stage = Path(tempfile.mkdtemp(prefix=".property-upload-", dir=handler.server.directory))
    try:
        path = stage / name
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        remaining = size
        with os.fdopen(fd, "wb") as stream:
            while remaining:
                chunk = handler.rfile.read(min(65536, remaining))
                if not chunk:
                    fail("REQUEST_INCOMPLETE")
                stream.write(chunk)
                remaining -= len(chunk)
            stream.flush()
            os.fsync(stream.fileno())
        workspace = Workspace(handler.server.directory)
        try:
            result = PropertyResearch(workspace).import_document(str(path), metadata)
            handler.result({"ok": True, "result": result})
        finally:
            workspace.close()
    finally:
        shutil.rmtree(stage)

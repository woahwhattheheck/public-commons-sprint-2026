"""Read bounded, isolated catalogue projections of original atomic JSON records.

Full scientific records stay on their original APIs and filesystem paths.
Only projected JSON bytes are cached; callers never receive a shared object.
"""
from __future__ import annotations

from collections import OrderedDict
import json
import os
from pathlib import Path
import threading

from .common import canonical
from .delivery_catalogue import delivery_view


def _signature(value):
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


class ProjectedFileCache:
    """Small process-local cache, invalidated by original file identity changes."""

    def __init__(self, *, max_entries=2048, max_bytes=8 * 1024 * 1024):
        if (isinstance(max_entries, bool) or not isinstance(max_entries, int) or
                isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or
                max_entries < 0 or max_bytes < 0):
            raise ValueError("Catalogue cache limits must be nonnegative integers")
        self.max_entries, self.max_bytes = max_entries, max_bytes
        self._entries = OrderedDict()
        self._bytes = 0
        self._lock = threading.RLock()

    def _discard(self, key):
        entry = self._entries.pop(key, None)
        if entry is not None:
            self._bytes -= len(entry[1])

    def retain_paths(self, paths):
        """Remove deleted records without retaining a separate on-disk index."""
        selected = {str(Path(path).absolute()) for path in paths}
        with self._lock:
            for key in list(self._entries):
                if key not in selected:
                    self._discard(key)

    def read(self, path, project):
        path = Path(path)
        key = str(path.absolute())
        current = _signature(path.stat())
        with self._lock:
            cached = self._entries.get(key)
            if cached is not None and cached[0] == current:
                self._entries.move_to_end(key)
                return json.loads(cached[1])

        # An atomic replacement leaves the opened descriptor a coherent edition.
        # Detect in-place modification as well, and never cache an unstable read.
        with path.open("rb") as stream:
            before = _signature(os.fstat(stream.fileno()))
            value = json.load(stream)
            after = _signature(os.fstat(stream.fileno()))
        if before != after:
            raise ValueError("Retained catalogue record changed during reading: " + str(path))
        body = canonical(project(value))
        try:
            still_current = _signature(path.stat()) == after
        except FileNotFoundError:
            still_current = False
        with self._lock:
            self._discard(key)
            if (still_current and self.max_entries and
                    len(body) <= self.max_bytes):
                while self._entries and (len(self._entries) >= self.max_entries or
                                         self._bytes + len(body) > self.max_bytes):
                    _, removed = self._entries.popitem(last=False)
                    self._bytes -= len(removed[1])
                self._entries[key] = (after, body)
                self._bytes += len(body)
        return json.loads(body)


def delivery_summary(record):
    """Fields used by original delivery catalogues; full record is read on open."""
    result = {key: value for key, value in record.items()
              if key not in {"files", "maps", "manifest", "priority", "parcel_priorities"}}
    maps = record.get("maps") or {}
    files = record.get("files") or {}
    if not isinstance(maps, dict) or not isinstance(files, dict):
        raise ValueError("Retained delivery maps and files must be objects")
    # Existing list views count map names, so retain those exact names.
    result["maps"] = dict.fromkeys(maps)
    result["_delivery_view"] = delivery_view(record)
    result["map_count"] = len(maps)
    result["file_count"] = len(files)
    # The original conservation portfolio picker uses this producer count.
    # Keep its legacy single-file eligibility path without the full inventory.
    parcels = record.get("parcel_priorities")
    if isinstance(parcels, dict):
        result["parcel_priorities"] = (
            {"features": parcels["features"]} if "features" in parcels else {}
        )
        if files.get("parcel_csv"):
            result["files"] = {"parcel_csv": files["parcel_csv"]}
    result["_catalogue"] = {
        "schema": "upstate.operator-record-summary/v1",
        "kind": "deliveries", "full_record_available": True,
    }
    return result


def task_summary(record):
    """Preserve exact request/recovery state; compact only known core results.

    Extension task result contracts remain unchanged. Native action payloads,
    attempts, transfer metadata and handler availability are always retained.
    """
    result = dict(record)
    value = record.get("result")
    if not isinstance(value, dict):
        return result
    action = record.get("action")
    if action == "delivery.build":
        result["result"] = delivery_summary(value)
    elif action == "source.import":
        result["result"] = {key: item for key, item in value.items() if key != "entries"}
        result["result"]["entry_count"] = len(value.get("entries", []))
        result["result"]["_catalogue"] = {
            "schema": "upstate.operator-record-summary/v1",
            "kind": "sources", "full_record_available": True,
        }
    return result

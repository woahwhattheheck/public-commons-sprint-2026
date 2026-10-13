"""Original task request metadata for responsive submission de-duplication.

This catalogue never substitutes for the full original task returned on reuse.
"""
from __future__ import annotations

from model.record_catalog import ProjectedFileCache


def _request_metadata(record):
    return {key: record[key] for key in
            ("id", "workspace", "state", "request_sha256", "created_at")
            if key in record}


class TaskRequests:
    def __init__(self, root):
        self.root = root
        # Original requests are small even when their completed results are large.
        self.cache = ProjectedFileCache(max_entries=32768, max_bytes=16 * 1024 * 1024)

    def matching(self, workspace, request_sha256, active_states):
        paths = list((self.root / "tasks").glob("*.json"))
        self.cache.retain_paths(paths)
        rows = [self.cache.read(path, _request_metadata) for path in paths]
        rows = [row for row in rows if row["workspace"] == workspace]
        # Match original task_list ordering and required creation-time handling
        # before active filtering; missing timestamps are not invented.
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return [row for row in rows if row["state"] in active_states
                and row["request_sha256"] == request_sha256]

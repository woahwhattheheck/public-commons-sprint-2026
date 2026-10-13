"""Core operator catalogues over the original retained Workspace records.

These readers are opt-in; full model record APIs keep their original behavior.
Changed immutable records pass the same content-identity check as Workspace._get.
"""
from __future__ import annotations

from .common import digest, identifier
from .record_catalog import ProjectedFileCache


def observation_summary(value):
    result = dict(value)
    result["row_count"] = len(result["rows"])
    result.pop("rows")
    return result


def run_summary(value):
    """Keep native stage presence for programme checks and original list metadata."""
    result = dict(value)
    stages = value.get("stages", {})
    retained = {
        name: {key: item for key, item in stage.items()
               if key in {"started_at", "completed_at", "reused_from", "reused_at", "runtime"}}
        for name, stage in stages.items()
    }
    result["stage_summary"] = {
        name: {**retained[name], "file_count": len(stage.get("files", {}))}
        for name, stage in stages.items()
    }
    # ProgrammeActivity validates stage presence/completion against artifacts.
    # Its actual execution locks are still inspected on every response.
    result["stages"] = retained
    return result


class OperatorCatalogue:
    """One bounded cache shared by the core collection readers of a Workspace."""

    def __init__(self, root):
        self.root = root
        self.cache = ProjectedFileCache()

    def immutable(self, kind, visited):
        folder = self.root / kind
        paths = sorted(folder.glob("*.json")) if folder.exists() else []
        visited.extend(paths)
        rows = []
        for path in paths:
            key = identifier(path.stem)

            def project(value, key=key):
                if digest(value) != key:
                    raise ValueError("Retained " + kind + " item changed")
                record = {**value, "id": key}
                return observation_summary(record) if kind == "observations" else record

            rows.append(self.cache.read(path, project))
        return rows

    def mutable(self, kind, filename, visited):
        paths = sorted((self.root / kind).glob("*/" + filename))
        visited.extend(paths)
        project = run_summary if kind == "runs" else lambda value: value
        return [self.cache.read(path, project) for path in paths]

    def finish(self, visited):
        self.cache.retain_paths(visited)

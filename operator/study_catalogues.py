"""Compact operator study catalogues over original execution checkpoints.

Full model/API readers retain their case tables and native inspection behavior.
Only unchanged catalogue projections are cached; returned objects are independent.
"""
from __future__ import annotations

from model import experiments, parameter_studies
from model.common import digest, identifier
from model.record_catalog import ProjectedFileCache


def _parameter_summary(value):
    result = dict(value)
    result["case_count"] = len(result.get("cases", []))
    result.pop("cases", None)
    return result


class StudyCatalogues:
    def __init__(self):
        # Independent retention budgets; neither imposes a study or case limit.
        self.parameter_cache = ProjectedFileCache()
        self.experiment_cache = ProjectedFileCache()

    def parameter_studies(self, workspace):
        paths = sorted((workspace.root / "experiments").glob("*/experiment.json"))
        visited = []
        rows = []
        for path in paths:
            key = identifier(path.parent.name)
            spec_path = workspace.root / "experiment-specs" / (key + ".json")
            visited.extend((path, spec_path))

            def project_spec(value, key=key):
                # Same content identity as the original Workspace._get.
                if digest(value) != key:
                    raise ValueError("Retained experiment-specs item changed")
                return {**value, "id": key}

            spec = self.parameter_cache.read(spec_path, project_spec)

            def project_state(value, key=key, spec=spec):
                value = parameter_studies._bind_state(workspace, key, spec, value)
                return _parameter_summary(value)

            state = self.parameter_cache.read(path, project_state)
            # A changed specification or current project is checked even when
            # the execution checkpoint itself was an unchanged cache hit.
            rows.append(parameter_studies._bind_state(workspace, key, spec, state))
        self.parameter_cache.retain_paths(visited)
        return rows

    def experiments(self, workspace):
        paths = sorted((workspace.root / "experiments").glob("*/state.json"))
        rows = []
        for path in paths:
            key = identifier(path.parent.name)

            def project_state(value, key=key):
                return experiments._check_state(workspace, key, value)

            state = self.experiment_cache.read(path, project_state)
            rows.append(experiments._check_state(workspace, key, state))
        self.experiment_cache.retain_paths(paths)
        return sorted(rows, key=lambda item: (item["updated_at"], item["id"]), reverse=True)

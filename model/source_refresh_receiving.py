"""Read-only receiving of both original source-refresh plan formats.

Read immutable selections, retained source bytes and existing checkpoints.
Unstarted, interrupted and unresolved plans remain valid resumable work.
"""
from __future__ import annotations

from copy import deepcopy

from . import source_refresh
from .common import identifier, read_json, verify_file
from .source_refresh_legacy import SourceRefresh as OriginalSourceRefresh

KINDS = ("profiles", "scenarios", "grids", "runs")
DEPENDENCIES = (("grid_id", "grids"), ("profile_id", "profiles"),
                ("scenario_id", "scenarios"))


class _Receiving:
    def __init__(self, workspace):
        self.ws = workspace
        self.original = OriginalSourceRefresh(workspace)
        self.native_cache = {}
        self.source_cache = {}
        self.checked_sources = set()
        self.checked_files = set()
        self.comparisons = set()

    def files(self, directory, descriptors):
        for item in descriptors:
            signature = (str(directory), item["path"], item["sha256"], item["bytes"])
            if signature not in self.checked_files:
                verify_file(directory, item)
                self.checked_files.add(signature)

    def collection(self, key):
        key = identifier(key)
        if key not in self.source_cache:
            value = self.ws._get("sources", key)
            self.original._verify_sources(value, self.checked_sources)
            self.source_cache[key] = value
        return self.source_cache[key]

    def native(self, kind, key):
        key = identifier(key)
        cache_key = (kind, key)
        if cache_key in self.native_cache:
            return self.native_cache[cache_key]
        value = self.original._native(kind, key)
        if kind == "grids":
            self.files(self.ws.root / kind / key, value["files"].values())
        elif kind == "runs":
            self.files(self.ws.root / kind / key, value.get("artifacts", {}).values())
            for field, dependency_kind in DEPENDENCIES:
                self.native(dependency_kind, value["selection"][field])
        selection = self.original._selection(kind, value)
        if selection.get("source_collection_id"):
            collection = self.collection(selection["source_collection_id"])
            sources = self.original._entries(collection)
            for field, source_id in self.original._source_refs(kind, selection):
                if source_id not in sources:
                    raise ValueError("Retained native selection refers to a missing source: " + field)
        self.native_cache[cache_key] = value
        return value

    def roots(self, plan):
        if plan["workspace_id"] != self.ws.project["id"]:
            raise ValueError("Source-refresh plan belongs to another original workspace")
        self.collection(plan["from_collection_id"])
        self.collection(plan["to_collection_id"])
        difference = self.original.source_diff(
            plan["from_collection_id"], plan["to_collection_id"],
            plan["mapping"], verify=False)
        if (difference["changes"] != plan["changes"]
                or difference["counts"] != plan["source_counts"]):
            raise ValueError("Retained source changes disagree with the original editions")
        changes = {row["source_id"]: row for row in difference["changes"]
                   if row["source_id"] is not None}
        nodes = {}
        for node in plan["nodes"]:
            kind, old_id = node["kind"], identifier(node["old_id"])
            key = kind + "/" + old_id
            if key != node["key"] or key in nodes:
                raise ValueError("Source-refresh dependency keys are inconsistent")
            actual = self.native(kind, old_id)
            selection = self.original._selection(kind, actual)
            if selection != node["selection"]:
                raise ValueError("Original source-refresh selection changed: " + key)
            dependencies, references, action = [], [], "reuse"
            if kind == "runs":
                dependencies = [{"field": field, "key": dependency_kind + "/" + selection[field]}
                                for field, dependency_kind in DEPENDENCIES]
                if any(row["key"] not in nodes for row in dependencies):
                    raise ValueError("Source-refresh run is missing its ordered dependencies")
                actions = {nodes[row["key"]]["action"] for row in dependencies}
                action = "missing" if "missing" in actions else "derive" if "derive" in actions else "reuse"
            elif selection.get("source_collection_id") == plan["from_collection_id"]:
                for field, source_id in self.original._source_refs(kind, selection):
                    row = changes[source_id]
                    references.append({"field": field, "source_id": source_id,
                                       "replacement_id": row["replacement_id"], "change": row["change"]})
                actions = {row["change"] for row in references}
                action = "missing" if "removed" in actions else "derive" if "changed" in actions else "reuse"
            if (node["dependencies"] != dependencies or node["source_references"] != references
                    or node["action"] != action):
                raise ValueError("Source-refresh dependency graph disagrees with original selections: " + key)
            nodes[key] = node
        if any(key not in nodes for key in plan["roots"]):
            raise ValueError("Source-refresh root is missing from its dependency graph")
        state = self.original.state(plan["id"])
        steps = state["steps"]
        if set(steps) - set(nodes):
            raise ValueError("Refresh checkpoint contains an unknown dependency")
        if state.get("active_step") and state["active_step"] not in nodes:
            raise ValueError("Refresh checkpoint active step is outside its plan")
        for key, step in steps.items():
            new_id = step.get("new_id")
            if not new_id:
                if step.get("status") in ("prepared", "executing", "complete"):
                    raise ValueError("Prepared refresh checkpoint is missing its native result: " + key)
                continue
            node = nodes[key]
            if node["action"] == "missing":
                raise ValueError("Unresolved refresh dependency has a prepared result: " + key)
            actual = self.native(node["kind"], new_id)
            if node["action"] == "reuse":
                if new_id != node["old_id"]:
                    raise ValueError("Unchanged refresh dependency replaced its original ID: " + key)
                continue
            expected = deepcopy(node["selection"])
            if node["kind"] == "runs":
                for dependency in node["dependencies"]:
                    target = steps.get(dependency["key"], {}).get("new_id")
                    if not target:
                        raise ValueError("Refreshed run lacks a prepared dependency: " + key)
                    expected[dependency["field"]] = target
            else:
                expected["source_collection_id"] = plan["to_collection_id"]
                for reference in node["source_references"]:
                    self.original._assign(expected, reference["field"], reference["replacement_id"])
            if self.original._selection(node["kind"], actual) != expected:
                raise ValueError("Refresh checkpoint selects a different native result: " + key)

    def edition(self, plan):
        report = plan["preview"]
        if report.get("schema") != source_refresh.PREVIEW_SCHEMA or report["selection"] != plan["selection"]:
            raise ValueError("Retained source-refresh preview and selection disagree")
        for key in ("from_collection_id", "to_collection_id"):
            self.collection(plan["selection"][key])
        snapshots = {}
        for kind in KINDS:
            snapshots[kind] = {}
            for expected in report["snapshots"][kind]:
                old_id = identifier(expected["id"])
                if old_id in snapshots[kind]:
                    raise ValueError("Duplicate original source-refresh dependency: " + old_id)
                actual = self.native(kind, old_id)
                if kind == "grids":
                    matches = actual["spec"] == expected["spec"] and actual["grid"] == expected["grid"]
                elif kind == "runs":
                    matches = actual["selection"] == expected["selection"]
                else:
                    matches = actual == expected
                if not matches:
                    raise ValueError("Retained source-refresh dependency changed: " + old_id)
                snapshots[kind][old_id] = expected
        # Saved previews may contain unresolved mappings: receiving preserves
        # that work; applying remains responsible for requiring usable inputs.
        state = source_refresh._read_state(self.ws, plan["id"])
        if state is None:
            return
        mappings = state["mappings"]
        if set(mappings) - set(KINDS):
            raise ValueError("Refresh checkpoint contains an unknown selection kind")
        for kind in KINDS:
            for old_id, new_id in mappings.get(kind, {}).items():
                if old_id not in snapshots[kind]:
                    raise ValueError("Refresh checkpoint contains a dependency outside the frozen preview")
                original = snapshots[kind][old_id]
                actual = self.native(kind, new_id)
                if kind == "runs":
                    expected = {}
                    for field, dependency_kind in DEPENDENCIES:
                        previous = original["selection"][field]
                        target = mappings.get(dependency_kind, {}).get(previous)
                        if previous in snapshots[dependency_kind] and not target:
                            raise ValueError("Refreshed run lacks its updated dependency: " + field)
                        expected[field] = target or previous
                    if "models" in original["selection"]:
                        expected["models"] = original["selection"]["models"]
                    received = actual["selection"]
                else:
                    expected = source_refresh._remapped(kind, original, report)
                    received = actual["spec"] if kind == "grids" else source_refresh._clean(actual)
                if not source_refresh._expected_fields(received, expected):
                    raise ValueError("Refresh checkpoint selects a different native result: " + new_id)
        run_map = mappings.get("runs", {})
        if set(state.get("run_ids", [])) != set(run_map.values()):
            raise ValueError("Refresh run index disagrees with its prepared runs")
        for old_id, row in state.get("run_results", {}).items():
            self.run_pair(run_map, old_id, row)
        for old_id, row in state.get("comparison_results", {}).items():
            self.run_pair(run_map, old_id, row)
            if row.get("comparison_id"):
                self.comparison(row)
        for row in state.get("comparisons", []):
            self.run_pair(run_map, row["from_run_id"], row)
            self.comparison(row)

    @staticmethod
    def run_pair(mapping, old_id, row):
        if (old_id not in mapping or row.get("from_run_id") != old_id
                or row.get("to_run_id") != mapping[old_id]):
            raise ValueError("Refresh result points outside its original and prepared run pair")

    def comparison(self, row):
        key = identifier(row["comparison_id"])
        signature = (key, row["from_run_id"], row["to_run_id"])
        if signature in self.comparisons:
            return
        directory = self.ws.root / "comparisons" / key
        value = read_json(directory / "comparison.json")
        if (value.get("schema") != "upstate.run-comparison/v1" or value.get("id") != key
                or value.get("baseline_run_id") != row["from_run_id"]
                or [item["run_id"] for item in value["alternatives"]] != [row["to_run_id"]]):
            raise ValueError("Source-refresh comparison belongs to a different native run pair")
        self.native("runs", row["from_run_id"])
        for alternative in value["alternatives"]:
            run = self.native("runs", alternative["run_id"])
            if alternative["selection"] != run["selection"]:
                raise ValueError("Source-refresh comparison native selection changed")
            self.files(directory, alternative["artifacts"].values())
        self.comparisons.add(signature)


def verify_all(workspace):
    """Verify retained refresh plans without changing the receiving workspace."""
    receiving = _Receiving(workspace)
    counts = {"plans": 0, "roots": 0, "edition": 0}
    for plan in workspace._list(source_refresh.PLAN_KIND):
        engine = source_refresh.plan_engine(plan)
        if engine == "roots":
            receiving.roots(plan)
        elif engine == "edition":
            receiving.edition(plan)
        else:
            raise ValueError("Unsupported retained source-refresh plan format: " + plan["id"])
        counts["plans"] += 1
        counts[engine] += 1
    return {**counts, "source_collections": len(receiving.source_cache),
            "native_selections": len(receiving.native_cache),
            "retained_source_files": len(receiving.checked_sources),
            "retained_result_files": len(receiving.checked_files),
            "comparisons": len(receiving.comparisons)}

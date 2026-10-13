"""Original selected scientific input navigation for Investigations.

No task or scientific run is created. File opens use the existing Workspace
repository and authenticated Operator tickets. Export still uses
intelligence.collection.export with the original registered references.
"""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path

from eco_intelligence.common import IntelligenceError
from model.common import digest, identifier, relative_file, verify_file
from science_catalog import WorkspaceScienceCatalog, dataset_id

OPERATIONS = frozenset({"lineage", "lineage-source", "lineage-file"})


class InvestigationLineage:
    def __init__(self, operator):
        self.operator = operator
        self.catalog = WorkspaceScienceCatalog(operator)

    @staticmethod
    def _expected(body):
        return {"bytes": body["bytes"], "sha256": body["sha256"]}

    def _graph(self, workspace, repository, payload):
        selected = {key: payload.get(key) for key in ("grid_id", "run_id")
                    if payload.get(key) not in (None, "")}
        value = self.catalog.lineage(workspace, **selected)
        pinned = payload.get("lineage_sha256")
        if pinned is not None and identifier(pinned) != value["lineage_sha256"]:
            raise IntelligenceError("This lineage edition changed. Reopen the original selection.", 409)
        # Use the original provider's real IDs and full source bindings.
        rows = list(repository.read_records(workspace, "dataset"))
        by_source = {}
        for row in rows:
            binding = (row.get("metadata") or {}).get("source_binding")
            if not isinstance(binding, dict):
                continue
            key = (binding.get("collection_id"), binding.get("source_id"),
                   binding.get("member"), binding.get("role"))
            if not all(isinstance(item, str) for item in key):
                continue
            by_source.setdefault(key, []).append(row)
        refs, registry_issues = [], []
        for source in value["sources"]:
            members = []
            for role, body in [("primary", source["retained"])] + [
                    ("companion", item) for item in source["companions"]]:
                member = body.get("view_path", body.get("filename"))
                binding = (source["collection_id"], source["id"], member, role)
                matched = by_source.get(binding, [])
                item = {"role": role, "member": member, **deepcopy(body)}
                if len(matched) == 1 and all(matched[0].get(k) == body.get(k)
                                             for k in ("sha256", "bytes")):
                    item["ref"] = {"kind": "dataset", "id": matched[0]["id"]}
                    refs.append(item["ref"])
                else:
                    item["issue"] = "The exact original member is not uniquely registered."
                    registry_issues.append({"source_key": source["key"], "member": member,
                                            "message": item["issue"]})
                members.append(item)
            source["files"] = members
            source["export_complete"] = all("ref" in row for row in members)
        prepared = []
        for role, descriptor in sorted(value["grid"].get("files", {}).items()):
            key = dataset_id(value["grid"]["id"], role)
            matched = [row for row in rows if row["id"] == key]
            item = {"role": role, **deepcopy(descriptor)}
            if len(matched) == 1 and all(matched[0].get(k) == descriptor.get(k)
                                         for k in ("sha256", "bytes")):
                item["ref"] = {"kind": "dataset", "id": key}
            else:
                item["issue"] = "This prepared member is not uniquely registered."
            prepared.append(item)
        value.update(prepared_files=prepared, original_refs=refs,
                     registry_issues=registry_issues,
                     export_complete=not value["issues"] and not registry_issues)
        return value

    def _ticket(self, workspace, repository, item):
        ref = item.get("ref")
        if not isinstance(ref, dict):
            raise IntelligenceError("The exact selected member is unavailable in the original registry.", 409)
        row = repository.row(workspace, "dataset", ref["id"])
        if any(row.get(k) != item.get(k) for k in ("bytes", "sha256")):
            raise IntelligenceError("The selected original member edition changed.", 409)
        path, _ = repository.path(workspace, ref)
        return self.operator._ticket(
            workspace, Path(path), {"path": str(Path(path).relative_to(self.operator.ws(workspace).root)),
                                   **self._expected(item),
                                   "filename": Path(item.get("member") or item.get("path") or path).name},
            label=item.get("member") or item.get("role") or "Original scientific input")

    def read(self, workspace, repository, operation, payload):
        try:
            graph = self._graph(workspace, repository, payload)
            if operation == "lineage":
                return graph
            if not payload.get("lineage_sha256"):
                raise IntelligenceError("Open the exact original lineage before selecting its files.", 422)
            if operation == "lineage-file":
                selected = payload.get("dataset_id")
                files = [item for source in graph["sources"] for item in source["files"]]
                files.extend(graph["prepared_files"])
                matches = [row for row in files if row.get("ref", {}).get("id") == selected]
                # The same registered member can appear in multiple use edges.
                unique = {digest(row): row for row in matches}
                if len(unique) != 1:
                    raise IntelligenceError("Select a registered file from this exact lineage.", 422)
                item = next(iter(unique.values()))
                return {"workspace_key": workspace, "selected": graph["selected"],
                        "lineage_sha256": graph["lineage_sha256"], "file": item,
                        "download": self._ticket(workspace, repository, item),
                        "verified": True}
            if operation != "lineage-source":
                raise IntelligenceError("Choose an installed source navigation route.", 404)
            pair = (payload.get("collection_id"), payload.get("source_id"))
            matches = [source for source in graph["sources"]
                       if (source["collection_id"], source["id"]) == pair]
            if len(matches) != 1:
                raise IntelligenceError("Select a source from this exact lineage.", 422)
            source = deepcopy(matches[0])
            for item in source["files"]:
                if "ref" in item:
                    item["download"] = self._ticket(workspace, repository, item)
                    item["verified"] = True
            ws = self.operator.ws(workspace)
            collection = ws._get("sources", pair[0])
            original = collection.get("original_manifest")
            manifest = None
            if original:
                expected = {"path": original["object"], **self._expected(original),
                            "filename": original["filename"]}
                verify_file(ws.root, expected)
                manifest = self.operator._ticket(
                    workspace, relative_file(ws.root, original["object"]), expected,
                    label="Complete original source manifest")
            return {"workspace_key": workspace, "selected": graph["selected"],
                    "lineage_sha256": graph["lineage_sha256"], "source": source,
                    "collection": {key: deepcopy(value) for key, value in collection.items()
                                   if key not in ("entries", "original_manifest")},
                    "original_manifest": manifest,
                    "dependencies": [row for row in graph["dependencies"]
                                     if row.get("source_key") == source["key"]],
                    "verified": source["export_complete"]}
        except IntelligenceError:
            raise
        except (OSError, ValueError, TypeError, KeyError) as error:
            raise IntelligenceError("The selected scientific input cannot be opened: " +
                                    ((error.strerror or "Original file unavailable")
                                     if isinstance(error, OSError) else str(error)), 409) from error

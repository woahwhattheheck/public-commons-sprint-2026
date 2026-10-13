"""Resolve ordered scenario masks by their complete original source pair.

The optional patch.source_collection_id is an explicit retained edition.
Omitted fields keep the original scenario-level source selection and request body.
"""
from __future__ import annotations

import copy
import json
from .common import identifier


def mask_collection(scenario, patch):
    """Validate an explicit source edition without replacing a missing value."""
    value = (patch["source_collection_id"] if "source_collection_id" in patch
             else scenario["source_collection_id"])
    return identifier(value)


def mask_source_id(patch):
    value = patch.get("mask_source_id")
    if not isinstance(value, str) or not value:
        raise ValueError("Select the original mask source ID for each ordered change")
    return value


def mask_pair(scenario, patch):
    return mask_collection(scenario, patch), mask_source_id(patch)


def pair_key(collection_id, source_id):
    return json.dumps([collection_id, source_id], ensure_ascii=False, separators=(",", ":"))


class ScenarioMaskSources:
    """One original source loader shared by save, preview and native execution."""
    def __init__(self, workspace, scenario):
        self.workspace = workspace
        self.default_collection = identifier(scenario["source_collection_id"])
        self.scenario = scenario
        self.sources = {}
        self.choices = []
        seen = set()
        for patch in scenario.get("patches", []):
            pair = mask_pair(scenario, patch)
            if pair not in seen:
                seen.add(pair)
                self.choices.append(pair)
                self(pair[1], pair[0])

    def __call__(self, source_id, collection_id=None):
        collection = self.default_collection if collection_id is None else identifier(collection_id)
        if not isinstance(source_id, str) or not source_id:
            raise ValueError("Select an original scenario mask source ID")
        pair = (collection, source_id)
        if pair not in self.sources:
            path, original = self.workspace.source_file(collection, source_id)
            if original.get("kind") not in ("vector", "raster"):
                raise ValueError("Scenario masks require retained polygons or binary raster sources")
            entry = copy.deepcopy(original)
            entry["source_collection_id"] = collection
            self.sources[pair] = (path, entry)
        return self.sources[pair]

    def request_masks(self):
        """Preserve legacy keys; cross-edition selections use full pair keys."""
        multiple = any(collection != self.default_collection for collection, _ in self.sources)
        result = {}
        for (collection, source_id), (_, entry) in sorted(self.sources.items()):
            name = pair_key(collection, source_id) if multiple else source_id
            value = {"body": copy.deepcopy(entry["body"]),
                     "companions": copy.deepcopy(entry.get("companions", []))}
            if multiple:
                value.update(source_collection_id=collection, source_id=source_id)
            result[name] = value
        return result
